import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  amountRange,
  countdownLabel,
  formatDate,
  formatTimestamp,
  urgencyOf,
} from "@/lib/format";
import {
  APPLICATION_STATUS_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  canWrite,
  watchNeedsAttention,
  type Application,
  type Opportunity,
  type OpportunityWatch,
} from "@/lib/types";
import { acknowledgeWatch, markVerified, startApplication } from "../actions";

export const metadata: Metadata = { title: "Opportunity · Grantboard" };

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle<Opportunity>();

  if (!opportunity) notFound();

  const { data: applicationRows } = await supabase
    .from("applications")
    .select("id, title, status, amount_requested, submitted_at")
    .eq("opportunity_id", opportunity.id)
    .order("created_at", { ascending: false });

  const applications = (applicationRows ?? []) as Pick<
    Application,
    "id" | "title" | "status" | "amount_requested" | "submitted_at"
  >[];

  const { data: watch } = await supabase
    .from("opportunity_watch")
    .select("*")
    .eq("opportunity_id", opportunity.id)
    .maybeSingle<OpportunityWatch>();

  const pageChanged = watchNeedsAttention(watch);

  const urgency = urgencyOf(opportunity.deadline);
  const writer = canWrite(session.role);

  return (
    <>
      <p className="small muted">
        <Link href="/opportunities">← All opportunities</Link>
      </p>

      <div className="page-head">
        <p className="eyebrow">{opportunity.funder_name}</p>
        <h1>{opportunity.program_name ?? "Untitled program"}</h1>
        <div className="btn-row">
          <span className="status-pill">
            {OPPORTUNITY_STATUS_LABELS[opportunity.status]}
          </span>
          {opportunity.verified ? (
            <span className="flag flag--verified">Verified</span>
          ) : (
            <span className="flag flag--unverified">Unverified</span>
          )}
          {opportunity.deadline_estimated ? (
            <span className="flag flag--estimated">Estimated date</span>
          ) : null}
        </div>
      </div>

      {pageChanged && watch ? (
        <div className="banner banner--change" role="status">
          <h2>{opportunity.funder_name}&rsquo;s page changed since anyone read it</h2>
          <p>
            The weekly check found different text at this URL on{" "}
            {formatDate(watch.last_changed_at)}. It does not read the page, so it
            cannot tell you <em>what</em> changed &mdash; open it and see. If the
            deadline moved, correct it there and verify it here.
          </p>
          {writer ? (
            <form action={acknowledgeWatch}>
              <input type="hidden" name="opportunity_id" value={opportunity.id} />
              <button type="submit" className="btn btn--ghost btn--small">
                I&rsquo;ve re-read the page
              </button>
            </form>
          ) : (
            <p className="small muted">
              Staff can clear this once they have re-read it.
            </p>
          )}
        </div>
      ) : null}

      {watch?.last_error && watch.consecutive_failures > 0 ? (
        <div className="banner banner--warn" role="status">
          <h2>The weekly check could not reach this page</h2>
          <p>
            {watch.consecutive_failures === 1
              ? "The last attempt failed"
              : `The last ${watch.consecutive_failures} attempts failed`}
            : {watch.last_error} A grant page that has moved or been taken down
            is worth opening by hand &mdash; a discontinued program is a deadline
            change in disguise.
          </p>
        </div>
      ) : null}

      {!opportunity.verified ? (
        <div className="banner banner--warn" role="status">
          <h2>This record has not been checked against the funder&rsquo;s page</h2>
          <p>
            Nobody has confirmed these details against{" "}
            {opportunity.funder_name}&rsquo;s current guidelines. Do not rely on
            the deadline, the amounts, or the eligibility language until someone
            has.
          </p>
        </div>
      ) : null}

      {opportunity.deadline_estimated ? (
        <div className="banner banner--warn" role="status">
          <h2>
            The deadline shown is projected from a prior year
          </h2>
          <p>
            {formatDate(opportunity.deadline)} came from last cycle&rsquo;s
            pattern, not from the funder&rsquo;s current page. Confirm it before
            anyone plans around it, and do not replace it with a different guess.
          </p>
        </div>
      ) : null}

      <div className="panel">
        <dl className="facts">
          <div>
            <dt>Deadline</dt>
            <dd>
              {formatDate(opportunity.deadline)}
              {opportunity.deadline_estimated ? (
                <>
                  {" "}
                  <span className="flag flag--estimated">Estimated</span>
                </>
              ) : null}
              <br />
              <span
                className={
                  urgency === "now" ? "small confirm-note" : "small muted"
                }
              >
                {countdownLabel(opportunity.deadline)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Award range</dt>
            <dd>{amountRange(opportunity.amount_min, opportunity.amount_max)}</dd>
          </div>
          <div>
            <dt>Funder page</dt>
            <dd>
              {opportunity.url ? (
                <a href={opportunity.url} target="_blank" rel="noreferrer">
                  {opportunity.url}
                </a>
              ) : (
                "—"
              )}
              <br />
              <span className="small muted">
                {!opportunity.url
                  ? "No URL, so the weekly check has nothing to watch."
                  : !watch?.last_checked_at
                    ? "Not checked yet — the weekly run will pick it up."
                    : `Checked weekly · last looked ${formatTimestamp(
                        watch.last_checked_at,
                      )}`}
              </span>
            </dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>
              {opportunity.verified
                ? `Verified ${formatTimestamp(opportunity.verified_at)}`
                : "Not verified"}
            </dd>
          </div>
        </dl>
      </div>

      {/* The eligibility language is the most consequential text on this page,
          so it gets the most prominent treatment. Quoted, never summarized. */}
      <div className="section-rule">
        <h2>Eligibility, in the funder&rsquo;s words</h2>
      </div>

      {opportunity.eligibility ? (
        <blockquote className="quoted">
          {opportunity.eligibility}
          <span className="quoted-source">
            Quoted verbatim from {opportunity.funder_name}
            {opportunity.url ? (
              <>
                {" · "}
                <a href={opportunity.url} target="_blank" rel="noreferrer">
                  source
                </a>
              </>
            ) : null}
            . Never edit this into a summary — the exact wording is what decides
            whether we can apply.
          </span>
        </blockquote>
      ) : (
        <div className="empty">
          <p>
            No eligibility language has been quoted yet. Open the funder&rsquo;s
            page and paste their own words in.
          </p>
        </div>
      )}

      {opportunity.notes ? (
        <>
          <div className="section-rule">
            <h2>Notes</h2>
          </div>
          <div className="panel">
            <p className="prewrap">{opportunity.notes}</p>
          </div>
        </>
      ) : null}

      <div className="section-rule">
        <h2>Applications</h2>
      </div>

      {applications.length === 0 ? (
        <div className="empty">
          <p>No application started for this opportunity.</p>
        </div>
      ) : (
        <ul className="strips">
          {applications.map((application) => (
            <li key={application.id}>
              <Link
                href={`/applications/${application.id}`}
                className="strip strip--later"
              >
                <div className="strip-top">
                  <span className="strip-funder">
                    {APPLICATION_STATUS_LABELS[application.status]}
                  </span>
                </div>
                <div className="strip-title">{application.title}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {writer ? (
        <div className="panel" style={{ marginTop: "1.5rem" }}>
          <h3>Staff actions</h3>
          <div className="btn-row">
            <form action={startApplication}>
              <input type="hidden" name="opportunity_id" value={opportunity.id} />
              <button className="btn" type="submit">
                Start an application
              </button>
            </form>

            {!opportunity.verified ? (
              <form action={markVerified}>
                <input type="hidden" name="id" value={opportunity.id} />
                <label className="small" style={{ marginRight: "0.5rem" }}>
                  <input
                    type="checkbox"
                    name="deadline_confirmed"
                    style={{ width: "auto", marginRight: "0.35rem" }}
                  />
                  I also confirmed the deadline on the funder&rsquo;s page
                </label>
                <button className="btn btn--ghost" type="submit">
                  Mark verified
                </button>
              </form>
            ) : null}
          </div>
          <p className="hint">
            Marking verified means you personally opened{" "}
            {opportunity.url ?? "the funder's page"} and read it. Tick the
            deadline box only if you read the date there too.
          </p>
        </div>
      ) : null}
    </>
  );
}
