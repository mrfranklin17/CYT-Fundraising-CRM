"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { canWrite } from "@/lib/types";

export type SaveResult = { ok: boolean; message: string };

export async function saveAnswerEntry(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const session = await requireSession();

  if (!canWrite(session.role)) {
    return {
      ok: false,
      message: "Board accounts can read the answer library but not edit it.",
    };
  }

  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "");

  if (!id) return { ok: false, message: "Missing entry id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("answer_library")
    .update({ body, updated_by: session.userId })
    .eq("id", id)
    .eq("org_id", session.orgId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/answers");
  return { ok: true, message: "Saved." };
}
