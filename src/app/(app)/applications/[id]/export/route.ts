import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatShortDate } from "@/lib/format";
import { wordCount } from "@/lib/format";
import type { Application, ApplicationQuestion, Opportunity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The field-mapped packet.
 *
 * This is the deliverable, because there is no submission API to hand it to.
 * It is laid out so a staff member can work down it with the funder's portal
 * open beside them, copying one field at a time — and it carries its warnings
 * with it, since the exported file will outlive this page.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: application } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .maybeSingle<Application>();

  if (!application) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const [opportunityResult, questionsResult, orgResult] = await Promise.all([
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
    supabase
      .from("orgs")
      .select("name, legal_name, ein, website, phone")
      .eq("id", application.org_id)
      .maybeSingle<{
        name: string;
        legal_name: string | null;
        ein: string | null;
        website: string | null;
        phone: string | null;
      }>(),
  ]);

  const opportunity = opportunityResult.data;
  const questions = (questionsResult.data ?? []) as ApplicationQuestion[];
  const org = orgResult.data;

  const unread = questions.filter((q) => q.source === "ai_draft");
  const confirms = questions.reduce(
    (sum, q) => sum + ((q.answer ?? "").match(/\[CONFIRM/gi) ?? []).length,
    0,
  );

  const rule = "=".repeat(72);
  const lines: string[] = [];

  lines.push(rule);
  lines.push(`GRANT APPLICATION PACKET — ${application.title}`);
  lines.push(rule);
  lines.push("");
  lines.push(
    "This is a copy-and-paste packet. Grantboard cannot submit it for you:",
  );
  lines.push(
    "Submittable, Foundant, Fluxx and Grants.gov have no third-party submission",
  );
  lines.push(
    "API. Open the funder's own portal and paste each field below into it.",
  );
  lines.push("");
  lines.push(`Exported: ${new Date().toLocaleString("en-US")}`);
  lines.push("");

  if (unread.length > 0 || confirms > 0) {
    lines.push("-".repeat(72));
    lines.push("BEFORE YOU PASTE ANY OF THIS ANYWHERE");
    lines.push("-".repeat(72));
    if (unread.length > 0) {
      lines.push(
        `* ${unread.length} ${unread.length === 1 ? "answer is" : "answers are"} still an unread AI draft. Nobody has read` ,
      );
      lines.push("  or edited them since the model wrote them.");
    }
    if (confirms > 0) {
      lines.push(
        `* ${confirms} [CONFIRM: ...] ${confirms === 1 ? "marker" : "markers"} remain. Each one is a fact nobody has`,
      );
      lines.push(
        "  verified. Replace them with real numbers from staff records — never",
      );
      lines.push("  with an estimate that looks about right.");
    }
    lines.push("");
  }

  lines.push("-".repeat(72));
  lines.push("APPLICANT");
  lines.push("-".repeat(72));
  lines.push(`Organization:   ${org?.name ?? ""}`);
  if (org?.legal_name) lines.push(`Legal name:     ${org.legal_name}`);
  if (org?.ein) lines.push(`EIN:            ${org.ein}`);
  if (org?.phone) lines.push(`Phone:          ${org.phone}`);
  if (org?.website) lines.push(`Website:        ${org.website}`);
  lines.push("");

  if (opportunity) {
    lines.push("-".repeat(72));
    lines.push("FUNDER");
    lines.push("-".repeat(72));
    lines.push(`Funder:         ${opportunity.funder_name}`);
    if (opportunity.program_name)
      lines.push(`Program:        ${opportunity.program_name}`);
    if (opportunity.url) lines.push(`Portal / page:  ${opportunity.url}`);
    if (opportunity.deadline) {
      lines.push(
        `Deadline:       ${formatShortDate(opportunity.deadline)}${
          opportunity.deadline_estimated
            ? "   *** ESTIMATED from a prior year — NOT confirmed on the"
            : ""
        }`,
      );
      if (opportunity.deadline_estimated) {
        lines.push(
          "                    funder's current page. Confirm before relying on it. ***",
        );
      }
    }
    if (!opportunity.verified) {
      lines.push("");
      lines.push(
        "*** This funder record has not been verified against the funder's current",
      );
      lines.push("    page. Treat its details as provisional. ***",
      );
    }
    lines.push("");

    if (opportunity.eligibility) {
      lines.push("-".repeat(72));
      lines.push("ELIGIBILITY — THE FUNDER'S OWN WORDS, QUOTED");
      lines.push("-".repeat(72));
      lines.push(opportunity.eligibility);
      lines.push("");
    }
  }

  lines.push(rule);
  lines.push("FIELDS");
  lines.push(rule);
  lines.push("");

  questions.forEach((question, index) => {
    const answer = (question.answer ?? "").trim();
    const words = wordCount(answer);

    lines.push("-".repeat(72));
    lines.push(`FIELD ${index + 1}: ${question.prompt}`);

    const meta: string[] = [];
    if (question.word_limit) meta.push(`limit ~${question.word_limit} words`);
    meta.push(`${words} words`);
    if (question.source === "ai_draft") meta.push("UNREAD AI DRAFT");
    if (question.source === "empty" || !answer) meta.push("BLANK");
    lines.push(`(${meta.join(" · ")})`);
    lines.push("-".repeat(72));
    lines.push(answer || "[BLANK — nothing drafted for this field]");
    lines.push("");
  });

  lines.push(rule);
  lines.push("END OF PACKET");
  lines.push(rule);

  const filename = `${application.title.replace(/[^\w.-]+/g, "-").toLowerCase()}-packet.txt`;

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
