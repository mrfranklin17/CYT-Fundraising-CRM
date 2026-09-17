import type { SupabaseClient } from "@supabase/supabase-js";

type LogArgs = {
  orgId: string;
  userId: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  detail?: Record<string, unknown>;
};

/**
 * Append to the activity log. Best effort on purpose: a failed log line must
 * never take down the action it was describing.
 */
export async function logActivity(
  supabase: SupabaseClient,
  { orgId, userId, entityType, entityId, action, detail }: LogArgs,
): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      org_id: orgId,
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId ?? null,
      action,
      detail: detail ?? {},
    });
  } catch {
    // Intentionally swallowed.
  }
}
