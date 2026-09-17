import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DraftEditor from "./DraftEditor";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { countdownLabel, formatShortDate } from "@/lib/format";
import {
  APPLICATION_STATUS_LABELS,
  canWrite,
  type Application,
  type ApplicationQuestion,
  type ApplicationStatus,
  type Opportunity,
} from "@/lib/types";
import { updateApplicationStatus } from "./actions";

export const metadata: Metadata = { title: "Draft · Grantboard" };

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: application } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle<Application>();

  if (!application) notFound();

  const [opportunityResult, questionsResult] = await Promise.all([
    supabase
      .from("opportunities")
      .select("*")
      .eq("id", application.opportunity_id)
      .maybeSingle<Opportunity>(),
    supabase
      .from("application_questions")
      .select("*")
      .eq("application_id", application.id)
      .order("sort_order", { ascending: true }),
  ]);

  const opportunity = opportunityResult.data;
  const questions = (questionsResult.data ?? []) as ApplicationQuestion[];
  const editable = canWrite(session.role);

  return (
    <>
      <p className="small muted">
        {opportunity ? (
          <Link href={`/opportunities/${opportunity.id}`}>
            ← {opportunity.funder_name}
          </Link>
        ) : (
          <Link href="/opportunities">← All opportunities</Link>
        )}
      </p>

      <div className="page-head">
        <p className="eyebrow">Application draft</p>
        <h1>{application.title}</h1>
        <div className="btn-row">
          <span className="status-pill">
            {APPLICATION_STATUS_LABELS[application.status]}
          </span>
          {opportunity?.deadline ? (
            <>
              <span className="small muted">
                Due {formatShortDate(opportunity.deadline)} ·{" "}
                {countdownLabel(opportunity.deadline)}
              </span>
              {opportunity.deadline_estimated ? (
                <span className="flag flag--estimated">Estimated date</span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Said here, once, plainly — because the expectation this sets is the
          difference between a tool that helps and a tool that loses a grant. */}
      <div className="banner banner--info">
        <h2>There is no submit button, and there never will be</h2>
        <p>
          Submittable, Foundant, Fluxx and Grants.gov have no third-party
          submission API. Nothing here can send an application on your behalf.
          Draft the answers, export the packet, then paste each field into the
          funder&rsquo;s own portal and submit it there.
        </p>
      </div>

      {opportunity?.eligibility ? (
        <details className="panel">
          <summary>
            <strong>{opportunity.funder_name}</strong> eligibility, quoted
            verbatim — read before drafting
          </summary>
          <blockquote className="quoted" style={{ marginTop: "0.85rem" }}>
            {opportunity.eligibility}
            <span className="quoted-source">
              Quoted verbatim from {opportunity.funder_name}.
            </span>
          </blockquote>
        </details>
      ) : null}

      {questions.length === 0 ? (
        <div className="empty">
          <p>This application has no questions yet.</p>
        </div>
      ) : (
        <DraftEditor
          questions={questions}
          applicationId={application.id}
          editable={editable}
        />
      )}

      {editable ? (
        <div className="panel">
          <h3>Status</h3>
          <form action={updateApplicationStatus} className="btn-row">
            <input type="hidden" name="id" value={application.id} />
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="visually-hidden">Application status</span>
              <select name="status" defaultValue={application.status}>
                {(
                  Object.keys(APPLICATION_STATUS_LABELS) as ApplicationStatus[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {APPLICATION_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn--ghost btn--small" type="submit">
              Update
            </button>
          </form>
          <p className="hint">
            &ldquo;Submitted&rdquo; means a person pasted this into the
            funder&rsquo;s portal and pressed their submit button. Grantboard
            cannot know that on its own.
          </p>
        </div>
      ) : null}
    </>
  );
}
