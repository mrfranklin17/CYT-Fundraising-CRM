import Link from "next/link";
import type { Metadata } from "next";
import OpportunityStrip from "@/components/OpportunityStrip";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { daysUntil, money } from "@/lib/format";
import { canWrite, type Opportunity } from "@/lib/types";

export const metadata: Metadata = { title: "Callboard · Grantboard" };

const OPEN_STATUSES = ["prospect", "drafting"] as const;

export default async function CallboardPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("org_id", session.orgId)
    .order("deadline", { ascending: true, nullsFirst: false });

  if (error) throw error;

  const opportunities = (data ?? []) as Opportunity[];
  const open = opportunities.filter((o) =>
    (OPEN_STATUSES as readonly string[]).includes(o.status),
  );

  const closingSoon = open.filter((o) => {
    const days = daysUntil(o.deadline);
    return days !== null && days >= 0 && days <= 45;
  });

  // Pipeline value uses the top of each range: the most we could ask for from
  // what is currently open. Stated plainly so nobody reads it as expected income.
  const pipelineTotal = open.reduce(
    (sum, o) => sum + (o.amount_max ?? o.amount_min ?? 0),
    0,
  );

  const unverified = open.filter((o) => !o.verified);

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Callboard</p>
        <h1>What is up on the board</h1>
        <p className="lede">
          Everything open for {session.orgName}, in deadline order. Dates marked{" "}
          <em>estimated</em> came from last year&rsquo;s pattern, not from the
          funder&rsquo;s page.
        </p>
      </div>

      {unverified.length > 0 ? (
        <div className="banner banner--warn" role="status">
          <h2>
            {unverified.length === 1
              ? "1 prospect has not been checked against the funder's page"
              : `${unverified.length} prospects have not been checked against the funder's page`}
          </h2>
          <p>
            {unverified.map((o) => o.funder_name).join(", ")} —{" "}
            {unverified.length === 1 ? "this record" : "these records"} may carry
            a projected deadline or incomplete eligibility language. Open the
            funder&rsquo;s page, confirm the details, then mark it verified.
          </p>
        </div>
      ) : null}

      <dl className="counts">
        <div className="count">
          <dt>Open prospects</dt>
          <dd>{open.length}</dd>
        </div>
        <div className="count is-urgent">
          <dt>Closing within 45 days</dt>
          <dd>
            {closingSoon.length}
            <span className="count-note">
              {closingSoon.length === 0
                ? "Nothing due in the next six weeks."
                : closingSoon
                    .map((o) => o.funder_name)
                    .slice(0, 3)
                    .join(", ")}
            </span>
          </dd>
        </div>
        <div className="count is-brass">
          <dt>Total pipeline</dt>
          <dd>
            {money(pipelineTotal)}
            <span className="count-note">
              Top of each open award range. A ceiling, not a forecast.
            </span>
          </dd>
        </div>
      </dl>

      <div className="section-rule">
        <h2>By deadline</h2>
      </div>

      {opportunities.length === 0 ? (
        <div className="empty">
          <p>No opportunities on the board yet.</p>
          {canWrite(session.role) ? (
            <Link className="btn" href="/opportunities/new">
              Add the first one
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="strips">
          {opportunities.map((opportunity) => (
            <OpportunityStrip key={opportunity.id} opportunity={opportunity} />
          ))}
        </ul>
      )}
    </>
  );
}
