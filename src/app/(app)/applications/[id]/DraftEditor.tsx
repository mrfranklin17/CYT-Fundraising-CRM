"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { wordCount } from "@/lib/format";
import type { AnswerSource, ApplicationQuestion } from "@/lib/types";
import { saveAnswer } from "./actions";

type QuestionState = ApplicationQuestion & {
  status?: string;
  busy?: boolean;
};

function sourceFlag(source: AnswerSource) {
  if (source === "ai_draft") {
    return <span className="flag flag--ai">AI draft · unread</span>;
  }
  if (source === "human") {
    return <span className="flag flag--human">Edited by a person</span>;
  }
  return <span className="flag flag--neutral">Blank</span>;
}

export default function DraftEditor({
  questions: initial,
  applicationId,
  editable,
}: {
  questions: ApplicationQuestion[];
  applicationId: string;
  editable: boolean;
}) {
  const [questions, setQuestions] = useState<QuestionState[]>(initial);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkNote, setBulkNote] = useState("");
  const [, startTransition] = useTransition();

  const patch = useCallback((id: string, changes: Partial<QuestionState>) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...changes } : q)),
    );
  }, []);

  const draftOne = useCallback(
    async (id: string): Promise<boolean> => {
      patch(id, { busy: true, status: "Drafting…" });

      try {
        const response = await fetch("/api/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: id }),
        });

        const payload = await response.json();

        if (!response.ok) {
          patch(id, { busy: false, status: payload?.error ?? "Drafting failed." });
          return false;
        }

        patch(id, {
          busy: false,
          answer: payload.answer,
          source: "ai_draft",
          drafted_at: payload.draftedAt,
          status: "Drafted. Read it before it goes anywhere.",
        });
        return true;
      } catch {
        patch(id, {
          busy: false,
          status: "Could not reach the drafting service.",
        });
        return false;
      }
    },
    [patch],
  );

  const blanks = useMemo(
    () => questions.filter((q) => !q.answer || q.answer.trim() === ""),
    [questions],
  );

  const draftAllBlanks = useCallback(async () => {
    setBulkRunning(true);
    const targets = questions.filter((q) => !q.answer || q.answer.trim() === "");

    let done = 0;
    for (const target of targets) {
      setBulkNote(`Drafting ${done + 1} of ${targets.length}…`);
      // Sequential on purpose: a small org on a metered API key does not want
      // seven concurrent calls, and a failure part-way should stop cleanly.
      const ok = await draftOne(target.id);
      if (!ok) {
        setBulkNote(`Stopped after ${done} of ${targets.length}.`);
        setBulkRunning(false);
        return;
      }
      done += 1;
    }

    setBulkNote(
      done === 0
        ? "Nothing was blank."
        : `Drafted ${done} ${done === 1 ? "answer" : "answers"}. Every one still needs reading.`,
    );
    setBulkRunning(false);
  }, [questions, draftOne]);

  const onSave = useCallback(
    (id: string, answer: string) => {
      patch(id, { status: "Saving…" });
      const formData = new FormData();
      formData.set("id", id);
      formData.set("answer", answer);
      formData.set("application_id", applicationId);

      startTransition(async () => {
        const result = await saveAnswer(formData);
        patch(id, {
          status: result.message,
          source: result.source ?? undefined,
        });
      });
    },
    [applicationId, patch],
  );

  const aiCount = questions.filter((q) => q.source === "ai_draft").length;

  return (
    <>
      {aiCount > 0 ? (
        <div className="banner banner--warn" role="status">
          <h2>
            {aiCount} {aiCount === 1 ? "answer is" : "answers are"} still an
            unread machine draft
          </h2>
          <p>
            Anything flagged <strong>AI draft · unread</strong> has not been
            touched by a person since the model wrote it. Editing an answer —
            even slightly — marks it as read. Check every number against the
            source before this packet leaves the building.
          </p>
        </div>
      ) : null}

      {editable ? (
        <div className="panel">
          <div className="btn-row">
            <button
              className="btn btn--brass"
              type="button"
              onClick={draftAllBlanks}
              disabled={bulkRunning || blanks.length === 0}
            >
              {bulkRunning
                ? "Drafting…"
                : `Draft all blanks (${blanks.length})`}
            </button>
            <a className="btn btn--ghost" href={`/applications/${applicationId}/export`}>
              Export packet
            </a>
            {bulkNote ? <span className="small muted">{bulkNote}</span> : null}
          </div>
          <p className="hint">
            Drafts are built only from the organization profile, the 990
            history, the board roster, the answer library, and this
            funder&rsquo;s quoted eligibility text. Where a fact is missing the
            model writes <code>[CONFIRM: …]</code> instead of inventing one.
          </p>
        </div>
      ) : null}

      {questions.map((question) => {
        const answer = question.answer ?? "";
        const words = wordCount(answer);
        const over = question.word_limit ? words > question.word_limit : false;
        const confirms = (answer.match(/\[CONFIRM/gi) ?? []).length;

        return (
          <section
            key={question.id}
            className={`question ${
              question.source === "ai_draft"
                ? "is-ai"
                : question.source === "human"
                  ? "is-human"
                  : ""
            }`}
          >
            <div className="question-head">
              <h3 className="question-prompt">{question.prompt}</h3>
              {sourceFlag(question.source)}
            </div>

            {question.guidance ? (
              <p className="hint" style={{ marginTop: 0 }}>
                {question.guidance}
              </p>
            ) : null}

            <label>
              <span className="visually-hidden">{question.prompt}</span>
              <textarea
                value={answer}
                readOnly={!editable}
                rows={10}
                onChange={(e) =>
                  patch(question.id, {
                    answer: e.target.value,
                    status: "Unsaved changes",
                  })
                }
              />
            </label>

            <div className="question-foot">
              {editable ? (
                <>
                  <button
                    className="btn btn--small"
                    type="button"
                    onClick={() => onSave(question.id, answer)}
                    disabled={question.busy}
                  >
                    Save
                  </button>
                  <button
                    className="btn btn--small btn--ghost"
                    type="button"
                    onClick={() => draftOne(question.id)}
                    disabled={question.busy || bulkRunning}
                  >
                    {question.busy ? "Drafting…" : "Draft this"}
                  </button>
                </>
              ) : null}

              <span className={over ? "counter over" : "counter"}>
                {words} words
                {question.word_limit ? ` / ${question.word_limit}` : ""}
              </span>

              {confirms > 0 ? (
                <span className="confirm-note">
                  {confirms} [CONFIRM] {confirms === 1 ? "marker" : "markers"} to
                  resolve
                </span>
              ) : null}

              {question.status ? (
                <span className="small muted" role="status">
                  {question.status}
                </span>
              ) : null}
            </div>
          </section>
        );
      })}
    </>
  );
}
