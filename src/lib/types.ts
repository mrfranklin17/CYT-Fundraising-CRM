export type OrgRole = "board" | "staff" | "admin";

export type OpportunityStatus =
  | "prospect"
  | "drafting"
  | "submitted"
  | "awarded"
  | "declined"
  | "passed";

export type ApplicationStatus =
  | "not_started"
  | "drafting"
  | "internal_review"
  | "ready_to_export"
  | "submitted"
  | "awarded"
  | "declined";

export type AnswerSource = "empty" | "ai_draft" | "human";

export type Org = {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  ein: string | null;
  tax_exempt_status: string | null;
  exemption_issued_on: string | null;
  ntee_code: string | null;
  ntee_label: string | null;
  founded_year: number | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  website: string | null;
  fiscal_year_type: string | null;
  executive_name: string | null;
  executive_title: string | null;
  mission: string | null;
  mission_notes: string | null;
};

export type OrgFinancial = {
  id: string;
  fiscal_year: number;
  revenue: number | null;
  expenses: number | null;
  net: number | null;
  contributions: number | null;
  program_revenue: number | null;
  net_assets: number | null;
  source: string | null;
};

export type BoardMember = {
  id: string;
  name: string;
  title: string | null;
  is_officer: boolean;
  sort_order: number;
  source: string | null;
};

export type Opportunity = {
  id: string;
  org_id: string;
  funder_name: string;
  program_name: string | null;
  url: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  deadline_estimated: boolean;
  verified: boolean;
  verified_at: string | null;
  status: OpportunityStatus;
  eligibility: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * What the weekly watcher saw when it last fetched a funder's page.
 *
 * A row needs a person's attention while `last_changed_at` is set and
 * `acknowledged_at` is missing or older than it — see `watchNeedsAttention`.
 * The watcher records that the page changed and deliberately records nothing
 * about what it now says: reading the new date is a person's job.
 */
export type OpportunityWatch = {
  opportunity_id: string;
  org_id: string;
  url: string;
  content_hash: string | null;
  content_length: number | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_status: number | null;
  last_error: string | null;
  consecutive_failures: number;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};

export function watchNeedsAttention(
  watch: Pick<OpportunityWatch, "last_changed_at" | "acknowledged_at"> | null | undefined,
): boolean {
  if (!watch?.last_changed_at) return false;
  if (!watch.acknowledged_at) return true;
  return new Date(watch.acknowledged_at) < new Date(watch.last_changed_at);
}

export type Application = {
  id: string;
  org_id: string;
  opportunity_id: string;
  title: string;
  status: ApplicationStatus;
  amount_requested: number | null;
  internal_notes: string | null;
  submitted_at: string | null;
};

export type ApplicationQuestion = {
  id: string;
  org_id: string;
  application_id: string;
  prompt: string;
  guidance: string | null;
  word_limit: number | null;
  sort_order: number;
  answer: string | null;
  source: AnswerSource;
  drafted_at: string | null;
};

export type AnswerLibraryEntry = {
  id: string;
  key: string;
  title: string;
  category: string | null;
  body: string;
  sort_order: number;
  updated_at: string;
};

export const ROLE_LABELS: Record<OrgRole, string> = {
  board: "Board",
  staff: "Staff",
  admin: "Admin",
};

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  prospect: "Prospect",
  drafting: "Drafting",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  passed: "Passed",
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  not_started: "Not started",
  drafting: "Drafting",
  internal_review: "Internal review",
  ready_to_export: "Ready to export",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
};

/** Staff and admin may write drafts and add opportunities. Board reads. */
export function canWrite(role: OrgRole | null | undefined): boolean {
  return role === "staff" || role === "admin";
}

export function isAdmin(role: OrgRole | null | undefined): boolean {
  return role === "admin";
}
