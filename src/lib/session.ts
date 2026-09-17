import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/types";

export type Membership = {
  org_id: string;
  role: OrgRole;
  org: { id: string; name: string; slug: string };
};

export type Session = {
  userId: string;
  email: string | null;
  orgId: string;
  orgName: string;
  role: OrgRole;
};

/**
 * The signed-in user plus the org they belong to.
 *
 * A user with no membership is not an error — it is someone whose admin has
 * not invited them yet — so they get sent to a page that says so in plain
 * words. Multi-org users land on their first membership; when a second
 * organization joins, this is where an org switcher goes.
 */
export async function requireSession(): Promise<Session> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, orgs(id, name, slug)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) redirect("/no-access");

  const org = data.orgs as unknown as { id: string; name: string; slug: string } | null;

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: data.org_id,
    orgName: org?.name ?? "Your organization",
    role: data.role as OrgRole,
  };
}
