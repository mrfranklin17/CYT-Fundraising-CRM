"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { canWrite, type AnswerSource } from "@/lib/types";

export type AnswerSaveResult = {
  ok: boolean;
  message: string;
  source?: AnswerSource;
};

/**
 * Save a human-edited answer.
 *
 * `source` is deliberately not accepted from the caller. The database trigger
 * decides provenance: text that changes without a matching `drafted_at` stamp
 * is a person typing, so the row becomes 'human'.
 */
export async function saveAnswer(formData: FormData): Promise<AnswerSaveResult> {
  const session = await requireSession();

  if (!canWrite(session.role)) {
    return {
      ok: false,
      message: "Board accounts can read drafts but not write them.",
    };
  }

  const id = String(formData.get("id") ?? "");
  const answer = String(formData.get("answer") ?? "");
  const applicationId = String(formData.get("application_id") ?? "");

  if (!id) return { ok: false, message: "Missing question id." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("application_questions")
    .update({ answer })
    .eq("id", id)
    .eq("org_id", session.orgId)
    .select("source")
    .single();

  if (error) return { ok: false, message: error.message };

  if (applicationId) revalidatePath(`/applications/${applicationId}`);

  return { ok: true, message: "Saved.", source: data.source as AnswerSource };
}

export async function updateApplicationStatus(formData: FormData) {
  const session = await requireSession();
  if (!canWrite(session.role)) return;

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !status) return;

  const supabase = await createClient();
  await supabase
    .from("applications")
    .update({ status })
    .eq("id", id)
    .eq("org_id", session.orgId);

  revalidatePath(`/applications/${id}`);
}
