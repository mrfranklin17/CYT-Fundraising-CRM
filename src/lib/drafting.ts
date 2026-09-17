import { money } from "@/lib/format";
import type {
  AnswerLibraryEntry,
  ApplicationQuestion,
  BoardMember,
  Opportunity,
  Org,
  OrgFinancial,
} from "@/lib/types";

export const DRAFT_MODEL = "claude-sonnet-5";

/**
 * The rules that make a draft usable by a real organization.
 *
 * The failure mode this guards against is not a bad sentence — it is a
 * confident, fluent, invented number appearing in a document that goes to a
 * funder over a nonprofit's signature. A draft with gaps marked is honest work
 * a person can finish. A draft with plausible filler is a liability.
 */
export const DRAFT_SYSTEM_PROMPT = `You are helping a small nonprofit arts organization draft an answer to one question on a grant application.

You will be given: the organization's profile, its IRS Form 990 financial history, its board roster, its answer library, and the funder's eligibility language quoted verbatim.

Rules, in order of importance:

1. Use ONLY the facts provided. If a fact is not in the material given to you, you do not know it.

2. NEVER invent numbers, dates, participant counts, enrollment figures, scholarship amounts, demographics, outcomes, evaluation results, awards, partner names, or program names. Not as an example, not as a placeholder, not "for illustration". A plausible-looking invented number is the single worst thing you can produce here, because it will be read as fact and submitted over someone's signature.

3. Where a figure or fact is needed but missing, write [CONFIRM: what is needed] inline, exactly in that form, at the point in the sentence where it belongs. Write around it so the sentence still reads. Carry forward any [CONFIRM: ...] markers already present in the source material rather than resolving them.

4. If the funder's eligibility language rules out what is being proposed, SAY SO instead of drafting around it. Lead your response with a clear warning that names the disqualifying language and quotes it. Do not soften it, do not write a version that avoids mentioning it, and do not suggest wording that would obscure the problem. An organization that learns it is ineligible before applying has been well served; one that learns it after being disqualified has not.

5. Do not overstate. This organization's real numbers are modest. Write with specific, sourced facts rather than superlatives. If the honest version is unimpressive, write the honest version.

6. Match the requested word limit if one is given. Plain, concrete prose. No headings, no bullet lists unless the question asks for them, no preamble like "Here is a draft" — return only the answer text itself.

7. Financial figures must match the 990 data exactly as provided. Do not round them into vagueness, recompute them, or project forward.`;

type PromptInput = {
  org: Org;
  financials: OrgFinancial[];
  board: BoardMember[];
  library: AnswerLibraryEntry[];
  opportunity: Opportunity;
  question: ApplicationQuestion;
  applicationTitle: string;
};

function financialsBlock(rows: OrgFinancial[]): string {
  if (rows.length === 0) return "No Form 990 data on file.";

  return rows
    .map((row) =>
      [
        `FY${row.fiscal_year}:`,
        `total revenue ${money(Number(row.revenue))};`,
        `total expenses ${money(Number(row.expenses))};`,
        `net ${money(Number(row.net))};`,
        `contributions ${money(Number(row.contributions))};`,
        `program revenue ${money(Number(row.program_revenue))};`,
        `net assets ${money(Number(row.net_assets))}`,
      ].join(" "),
    )
    .join("\n");
}

export function buildDraftPrompt({
  org,
  financials,
  board,
  library,
  opportunity,
  question,
  applicationTitle,
}: PromptInput): string {
  const address = [
    org.address_line1,
    org.address_line2,
    [org.city, org.state].filter(Boolean).join(", "),
    org.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  const sections: string[] = [];

  sections.push(
    [
      "## ORGANIZATION",
      `Name: ${org.name}`,
      org.legal_name ? `Legal name: ${org.legal_name}` : null,
      org.ein ? `EIN: ${org.ein}` : null,
      org.tax_exempt_status ? `Tax status: ${org.tax_exempt_status}` : null,
      org.exemption_issued_on
        ? `Exemption issued: ${org.exemption_issued_on}`
        : null,
      org.ntee_code
        ? `NTEE: ${org.ntee_code}${org.ntee_label ? ` (${org.ntee_label})` : ""}`
        : null,
      org.founded_year ? `Founded: ${org.founded_year}` : null,
      address ? `Address: ${address}` : null,
      org.phone ? `Phone: ${org.phone}` : null,
      org.website ? `Website: ${org.website}` : null,
      org.fiscal_year_type ? `Fiscal year: ${org.fiscal_year_type}` : null,
      org.executive_name
        ? `Executive leadership: ${org.executive_name}${
            org.executive_title ? `, ${org.executive_title}` : ""
          }`
        : null,
      "",
      "Mission statement (as adopted):",
      org.mission ?? "(none recorded)",
      org.mission_notes
        ? `\nInternal notes on the mission — context for you, NOT text to reuse in the answer:\n${org.mission_notes}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  sections.push(
    [
      "## FORM 990 FINANCIAL HISTORY (three most recent years on file)",
      "Use these figures exactly as written. Do not recompute or project.",
      "",
      financialsBlock(financials),
      financials[0]?.source ? `\nSource: ${financials[0].source}` : "",
    ].join("\n"),
  );

  sections.push(
    [
      "## BOARD OF DIRECTORS",
      board.length === 0
        ? "No board roster on file."
        : board
            .map((m) => `${m.name} — ${m.title ?? "Director"}`)
            .join("\n"),
      board[0]?.source ? `\nSource: ${board[0].source}` : "",
      "\nThis roster gives names and titles only. Do not describe board members' professions, expertise, diversity, or governance practices — that information is not here.",
    ].join("\n"),
  );

  sections.push(
    [
      "## ANSWER LIBRARY",
      "Approved source material written by staff. Reuse these facts. Any [CONFIRM: ...] marker below is an unverified gap — carry it into your draft, do not resolve it.",
      "",
      library.length === 0
        ? "(empty)"
        : library
            .map((entry) => `### ${entry.title}\n${entry.body}`)
            .join("\n\n"),
    ].join("\n"),
  );

  sections.push(
    [
      "## THE FUNDER",
      `Funder: ${opportunity.funder_name}`,
      opportunity.program_name ? `Program: ${opportunity.program_name}` : null,
      opportunity.url ? `Page: ${opportunity.url}` : null,
      opportunity.amount_min || opportunity.amount_max
        ? `Award range: ${money(Number(opportunity.amount_min))} – ${money(
            Number(opportunity.amount_max),
          )}`
        : null,
      opportunity.deadline
        ? `Deadline: ${opportunity.deadline}${
            opportunity.deadline_estimated
              ? " (ESTIMATED from a prior-year pattern — not confirmed on the funder's page. Do not state this date as fact in the answer.)"
              : ""
          }`
        : null,
      opportunity.verified
        ? null
        : "NOTE: this opportunity record has not been verified against the funder's current page. Treat its details as provisional.",
      "",
      "### Eligibility language, quoted verbatim from the funder",
      "Read this before drafting. If it rules out what is being proposed, say so instead of drafting around it.",
      "",
      opportunity.eligibility ?? "(No eligibility language has been recorded.)",
      opportunity.notes
        ? `\n### Internal strategy notes (context for you, not text to reuse)\n${opportunity.notes}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  sections.push(
    [
      "## THE QUESTION TO ANSWER",
      `Application: ${applicationTitle}`,
      "",
      `Question: ${question.prompt}`,
      question.guidance ? `Internal guidance: ${question.guidance}` : null,
      question.word_limit
        ? `Word limit: approximately ${question.word_limit} words.`
        : null,
      "",
      "Return only the answer text. No preamble, no heading, no closing commentary.",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return sections.join("\n\n---\n\n");
}
