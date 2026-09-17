import Link from "next/link";
import type { Metadata } from "next";
import OpportunityStrip from "@/components/OpportunityStrip";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { canWrite, type Opportunity } from "@/lib/types";

export const metadata: Metadata = { title: "Opportunities · Grantboard" };

export default async function OpportunitiesPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("org_id", session.orgId)
    .order("deadline", { ascending: true, nullsFirst: false });

  if (error) throw error;

  const opportunities = (data ?? []) as Opportunity[];
  const verified = opportunities.filter((o) => o.verified);
  const unverified = opportunities.filter((o) => !o.verified);

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Pipeline</p>
        <h1>Opportunities</h1>
        <p className="lede">
          Every funder we are tracking. Verified records have been read off the
          funder&rsquo;s own page by a person; unverified ones have not.
        </p>
      </div>

      {canWrite(session.role) ? (
        <p className="btn-row">
          <Link className="btn" href="/opportunities/new">
            Add an opportunity
          </Link>
        </p>
      ) : null}

      {opportunities.length === 0 ? (
        <div className="empty">
          <p>Nothing tracked yet.</p>
        </div>
      ) : null}

      {verified.length > 0 ? (
        <>
          <div className="section-rule">
            <h2>Verified</h2>
          </div>
          <ul className="strips">
            {verified.map((o) => (
              <OpportunityStrip key={o.id} opportunity={o} />
            ))}
          </ul>
        </>
      ) : null}

      {unverified.length > 0 ? (
        <>
          <div className="section-rule">
            <h2>Not yet verified</h2>
          </div>
          <p className="small muted">
            These have not been checked against the funder&rsquo;s current page.
            Treat their dates and eligibility language as provisional.
          </p>
          <ul className="strips">
            {unverified.map((o) => (
              <OpportunityStrip key={o.id} opportunity={o} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
