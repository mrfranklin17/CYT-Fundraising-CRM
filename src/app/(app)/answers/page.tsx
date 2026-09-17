import type { Metadata } from "next";
import AnswerEntry from "./AnswerEntry";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { canWrite, type AnswerLibraryEntry } from "@/lib/types";

export const metadata: Metadata = { title: "Answer library · Grantboard" };

export default async function AnswersPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("answer_library")
    .select("*")
    .eq("org_id", session.orgId)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  const entries = (data ?? []) as AnswerLibraryEntry[];
  const editable = canWrite(session.role);
  const totalConfirms = entries.reduce(
    (sum, entry) => sum + (entry.body.match(/\[CONFIRM/gi) ?? []).length,
    0,
  );

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Source material</p>
        <h1>Answer library</h1>
        <p className="lede">
          The blocks every draft is built from. Anything the drafting model
          writes comes from here, from the organization profile, and from the
          funder&rsquo;s own eligibility language — nowhere else.
        </p>
      </div>

      {totalConfirms > 0 ? (
        <div className="banner banner--warn" role="status">
          <h2>
            {totalConfirms} {totalConfirms === 1 ? "item needs" : "items need"}{" "}
            confirming with staff
          </h2>
          <p>
            Every <code>[CONFIRM: …]</code> below marks a fact nobody has
            verified. The drafting model is instructed to carry these markers
            into drafts rather than filling them in with something plausible.
            Replace them with real numbers from staff records, not estimates.
          </p>
        </div>
      ) : null}

      {!editable ? (
        <div className="banner banner--info">
          <p>
            You have read access. Staff and admins can edit these entries.
          </p>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="empty">
          <p>No entries yet.</p>
        </div>
      ) : (
        entries.map((entry) => (
          <AnswerEntry key={entry.id} entry={entry} editable={editable} />
        ))
      )}
    </>
  );
}
