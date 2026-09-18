import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing.
 *
 * Supabase can hand the session back in more than one shape, and which one you
 * get depends on the flow, the email template and whether anything went wrong:
 *
 *   ?code=...                     PKCE — exchange it for a session
 *   ?token_hash=...&type=...      token-hash template — verify the OTP
 *   ?error=...                    Supabase is telling us why it failed
 *   #access_token=...             implicit flow, or an error in the fragment
 *
 * The fragment is the important one: a URL fragment is never sent to the
 * server, so this handler cannot see it at all. An earlier version of this
 * route only looked for `code` and reported "missing_code" for every other
 * case, which hid the real reason behind a message that was actively
 * misleading. Anything this handler cannot resolve server-side is now passed
 * to /auth/finish, which reads the fragment in the browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const next = searchParams.get("next") ?? "/";
  // Only ever redirect to a path on this origin.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const fail = (reason: string) =>
    NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(reason)}`,
    );

  // Supabase reported a failure in the query string. Surface its words, not ours.
  const errorDescription =
    searchParams.get("error_description") ??
    searchParams.get("error_code") ??
    searchParams.get("error");
  if (errorDescription) return fail(errorDescription);

  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail(error.message);
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  // Token-hash template (`{{ .TokenHash }}`). No code verifier involved, so
  // this path works from any browser or device.
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) return fail(error.message);
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  // Nothing usable in the query string. Whatever Supabase sent is either in the
  // fragment or absent entirely, and only the browser can tell us which.
  // Browsers carry an existing fragment across a redirect, so it survives this.
  const finish = new URL("/auth/finish", origin);
  if (safeNext !== "/") finish.searchParams.set("next", safeNext);
  return NextResponse.redirect(finish.toString());
}
