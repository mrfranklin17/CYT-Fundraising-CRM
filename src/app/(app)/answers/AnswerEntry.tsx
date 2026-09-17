"use client";

import { useActionState, useState } from "react";
import { wordCount } from "@/lib/format";
import { saveAnswerEntry, type SaveResult } from "./actions";
import type { AnswerLibraryEntry } from "@/lib/types";

export default function AnswerEntry({
  entry,
  editable,
}: {
  entry: AnswerLibraryEntry;
  editable: boolean;
}) {
  const [body, setBody] = useState(entry.body);
  const [result, formAction, pending] = useActionState<SaveResult | null, FormData>(
    saveAnswerEntry,
    null,
  );

  const confirms = (body.match(/\[CONFIRM/gi) ?? []).length;

  return (
    <section className="question">
      <div className="question-head">
        <h3 className="question-prompt">{entry.title}</h3>
        {entry.category ? (
          <span className="status-pill">{entry.category}</span>
        ) : null}
      </div>

      {editable ? (
        <form action={formAction}>
          <input type="hidden" name="id" value={entry.id} />
          <label>
            <span className="visually-hidden">{entry.title}</span>
            <textarea
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
            />
          </label>

          <div className="question-foot">
            <button className="btn btn--small" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            <span className="counter">{wordCount(body)} words</span>
            {confirms > 0 ? (
              <span className="confirm-note">
                {confirms} unconfirmed {confirms === 1 ? "item" : "items"}
              </span>
            ) : null}
            {result ? (
              <span className={result.ok ? "muted" : "confirm-note"} role="status">
                {result.message}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          <p className="prewrap">{entry.body}</p>
          <div className="question-foot">
            <span className="counter">{wordCount(entry.body)} words</span>
            {confirms > 0 ? (
              <span className="confirm-note">
                {confirms} unconfirmed {confirms === 1 ? "item" : "items"}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
