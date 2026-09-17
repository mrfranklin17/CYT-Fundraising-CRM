import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { canWrite } from "@/lib/types";
import { createOpportunity } from "../actions";

export const metadata: Metadata = { title: "Add an opportunity · Grantboard" };

export default async function NewOpportunityPage() {
  const session = await requireSession();
  if (!canWrite(session.role)) redirect("/opportunities");

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Pipeline</p>
        <h1>Add an opportunity</h1>
        <p className="lede">
          A new record starts unverified. Mark it verified only after someone
          has opened the funder&rsquo;s page and read it.
        </p>
      </div>

      <form action={createOpportunity} className="panel">
        <label className="field">
          <span>Funder name (required)</span>
          <input type="text" name="funder_name" required />
        </label>

        <label className="field">
          <span>Program name</span>
          <input type="text" name="program_name" placeholder="e.g. SAGA Round 3" />
        </label>

        <label className="field">
          <span>Funder page</span>
          <input type="url" name="url" placeholder="https://" />
        </label>

        <label className="field">
          <span>Smallest award</span>
          <input type="number" name="amount_min" min="0" step="1" />
        </label>

        <label className="field">
          <span>Largest award</span>
          <input type="number" name="amount_max" min="0" step="1" />
        </label>

        <label className="field">
          <span>Deadline</span>
          <input type="date" name="deadline" />
        </label>

        <label className="field">
          <span>
            <input
              type="checkbox"
              name="deadline_estimated"
              defaultChecked
              style={{ width: "auto", marginRight: "0.5rem" }}
            />
            This date is estimated from a prior year, not read off the
            funder&rsquo;s current page
          </span>
          <p className="hint">
            Leave this checked unless you are looking at the date on the
            funder&rsquo;s site right now. Estimated dates are labelled as such
            everywhere they appear.
          </p>
        </label>

        <label className="field">
          <span>Eligibility — the funder&rsquo;s own words, quoted</span>
          <textarea
            name="eligibility"
            placeholder="Paste the funder's eligibility and ineligible-expense language verbatim. Do not summarize it."
          />
          <p className="hint">
            Paste, do not paraphrase. The exact wording is what decides whether
            we can apply.
          </p>
        </label>

        <label className="field">
          <span>Internal notes</span>
          <textarea name="notes" placeholder="Fit, strategy, what to confirm." />
        </label>

        <div className="btn-row">
          <button className="btn" type="submit">
            Add to the board
          </button>
          <Link className="btn btn--ghost" href="/opportunities">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
