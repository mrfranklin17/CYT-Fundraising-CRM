import Link from "next/link";
import {
  amountRange,
  countdownLabel,
  formatShortDate,
  urgencyOf,
} from "@/lib/format";
import { OPPORTUNITY_STATUS_LABELS, type Opportunity } from "@/lib/types";

/**
 * One row on the callboard. The left bar encodes deadline urgency; the
 * "Estimated date" flag travels with the date everywhere it is printed,
 * because a projected deadline that looks like a real one is how a small
 * organization misses a round.
 */
export default function OpportunityStrip({
  opportunity,
}: {
  opportunity: Opportunity;
}) {
  const urgency = urgencyOf(opportunity.deadline);

  return (
    <li>
      <Link
        href={`/opportunities/${opportunity.id}`}
        className={`strip strip--${urgency}`}
      >
        <div className="strip-top">
          <span className="strip-funder">{opportunity.funder_name}</span>
          <span className="status-pill">
            {OPPORTUNITY_STATUS_LABELS[opportunity.status]}
          </span>
          {!opportunity.verified ? (
            <span className="flag flag--unverified">Unverified</span>
          ) : null}
        </div>

        <div className="strip-title">
          {opportunity.program_name ?? "Untitled program"}
        </div>

        <div className="strip-meta">
          <span className="strip-deadline">
            {formatShortDate(opportunity.deadline)}
          </span>
          {opportunity.deadline_estimated ? (
            <span className="flag flag--estimated">Estimated date</span>
          ) : null}
          <span className="strip-countdown">
            {countdownLabel(opportunity.deadline)}
          </span>
          <span>{amountRange(opportunity.amount_min, opportunity.amount_max)}</span>
        </div>
      </Link>
    </li>
  );
}
