import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function NoAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // If an invite has since been accepted, don't strand them here.
  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membership) redirect("/");

  async function signOut() {
    "use server";
    const client = await createClient();
    await client.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="centered">
      <div className="card">
        <p className="eyebrow">Grantboard</p>
        <h1>You are signed in, but not on a roster yet</h1>
        <p className="lede">
          Your account <strong>{user.email}</strong> is not attached to an
          organization. Ask an administrator to invite this exact email address,
          then sign in again — your access appears the moment they do.
        </p>
        <p className="hint">
          If you were invited at a different address, sign out and sign back in
          with that one.
        </p>
        <form action={signOut}>
          <button className="btn btn--ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
