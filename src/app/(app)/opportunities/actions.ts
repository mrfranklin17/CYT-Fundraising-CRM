"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { canWrite } from "@/lib/types";

/**
 * The question set a new application starts with. These are the questions
 * nearly every small-arts funder asks in some wording; staff edit the prompts
 * to match the actual portal before drafting.
 */
const DEFAULT_QUESTIONS: { prompt: string; guidance: string; words: number }[] = [
  {
    prompt: "Describe your organization's mission and history.",
    guidance: "Replace with the funder's exact wording and word limit.",
    words: 300,
  },
  {
    prompt: "What community need does this request address?",
    guidance: "Only claims that can be sourced. Leave [CONFIRM] markers in place.",
    words: 300,
  },
  {
    prompt: "Who will be served, and how many people?",
    guidance: "Participant counts must come from staff records, not estimates.",
    words: 250,
  },
  {
    prompt: "What will these funds be used for?",
    guidance: "Check the funder's unacceptable-expense list before answering.",
    words: 300,
  },
  {
    prompt: "How will you measure success?",
    guidance: "Describe what is actually tracked today.",
    words: 250,
  },
  {
    prompt: "Describe your organization's financial position.",
    guidance: "990 figures are in the organization profile.",
    words: 250,
  },
  {
    prompt: "Describe your board and leadership.",
    guidance: "Roster is on the organization page.",
    words: 200,
  },
];

function requireWriter(role: string) {
  if (!canWrite(role as never)) {
    throw new Error(
      "Your account can read the pipeline but not change it. Ask an admin for staff access.",
    );
  }
}

export async function createOpportunity(formData: FormData) {
  const session = await requireSession();
  requireWriter(session.role);

  const supabase = await createClient();

  const funder = String(formData.get("funder_name") ?? "").trim();
  if (!funder) throw new Error("A funder name is required.");

  const deadline = String(formData.get("deadline") ?? "").trim();
  const amountMin = String(formData.get("amount_min") ?? "").trim();
  const amountMax = String(formData.get("amount_max") ?? "").trim();

  // Both default to the cautious value: a new record is unverified, and its
  // date is an estimate, until a person says otherwise.
  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      org_id: session.orgId,
      funder_name: funder,
      program_name: String(formData.get("program_name") ?? "").trim() || null,
      url: String(formData.get("url") ?? "").trim() || null,
      amount_min: amountMin ? Number(amountMin) : null,
      amount_max: amountMax ? Number(amountMax) : null,
      deadline: deadline || null,
      deadline_estimated: formData.get("deadline_estimated") === "on",
      verified: false,
      eligibility: String(formData.get("eligibility") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error) throw error;

  await logActivity(supabase, {
    orgId: session.orgId,
    userId: session.userId,
    entityType: "opportunity",
    entityId: data.id,
    action: "created",
    detail: { funder_name: funder },
  });

  revalidatePath("/");
  revalidatePath("/opportunities");
  redirect(`/opportunities/${data.id}`);
}

/**
 * Marking verified is an assertion that a person opened the funder's page and
 * read it. It is deliberately a separate, explicit action.
 */
export async function markVerified(formData: FormData) {
  const session = await requireSession();
  requireWriter(session.role);

  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing opportunity id.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("opportunities")
    .update({
      verified: true,
      verified_at: new Date().toISOString(),
      verified_by: session.userId,
      deadline_estimated: formData.get("deadline_confirmed") === "on" ? false : undefined,
    })
    .eq("id", id)
    .eq("org_id", session.orgId);

  if (error) throw error;

  await logActivity(supabase, {
    orgId: session.orgId,
    userId: session.userId,
    entityType: "opportunity",
    entityId: id,
    action: "verified",
  });

  revalidatePath("/");
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${id}`);
}

export async function startApplication(formData: FormData) {
  const session = await requireSession();
  requireWriter(session.role);

  const opportunityId = String(formData.get("opportunity_id") ?? "");
  if (!opportunityId) throw new Error("Missing opportunity id.");

  const supabase = await createClient();

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, funder_name, program_name")
    .eq("id", opportunityId)
    .eq("org_id", session.orgId)
    .single();

  if (oppError) throw oppError;

  const title = [opportunity.funder_name, opportunity.program_name]
    .filter(Boolean)
    .join(" — ");

  const { data: application, error: appError } = await supabase
    .from("applications")
    .insert({
      org_id: session.orgId,
      opportunity_id: opportunity.id,
      title: title || "Untitled application",
      status: "drafting",
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (appError) throw appError;

  const { error: questionsError } = await supabase
    .from("application_questions")
    .insert(
      DEFAULT_QUESTIONS.map((q, index) => ({
        org_id: session.orgId,
        application_id: application.id,
        prompt: q.prompt,
        guidance: q.guidance,
        word_limit: q.words,
        sort_order: (index + 1) * 10,
      })),
    );

  if (questionsError) throw questionsError;

  await supabase
    .from("opportunities")
    .update({ status: "drafting" })
    .eq("id", opportunity.id)
    .eq("org_id", session.orgId);

  await logActivity(supabase, {
    orgId: session.orgId,
    userId: session.userId,
    entityType: "application",
    entityId: application.id,
    action: "created",
  });

  revalidatePath(`/opportunities/${opportunity.id}`);
  redirect(`/applications/${application.id}`);
}

/**
 * Record that a person has re-read a funder's page after the watcher flagged it.
 *
 * This clears the flag and nothing else. It deliberately does not touch
 * `verified` or `deadline_estimated`: "I looked at the page" and "I confirmed
 * the deadline" are different claims, and collapsing them is how a record ends
 * up marked verified because somebody glanced at it. Confirming the deadline is
 * the separate Verify action, which asks explicitly.
 */
export async function acknowledgeWatch(formData: FormData) {
  const session = await requireSession();
  requireWriter(session.role);

  const id = String(formData.get("opportunity_id") ?? "");
  if (!id) throw new Error("Missing opportunity id.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("opportunity_watch")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: session.userId,
    })
    .eq("opportunity_id", id)
    .eq("org_id", session.orgId);

  if (error) throw error;

  await logActivity(supabase, {
    orgId: session.orgId,
    userId: session.userId,
    entityType: "opportunity",
    entityId: id,
    action: "reread_funder_page",
  });

  revalidatePath("/");
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${id}`);
}
