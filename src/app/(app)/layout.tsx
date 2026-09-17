import Link from "next/link";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/types";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="masthead">
        <div className="wrap masthead-inner">
          {/* Wordmark only — see CLAUDE.md. The CYT logo belongs to CYT
              National; .logo-slot is where an approved file gets dropped in. */}
          <Link href="/" className="wordmark">
            <span className="logo-slot" aria-hidden="true">
              <span>GB</span>
            </span>
            <span className="wordmark-text">
              <b>Grantboard</b>
              <small>{session.orgName}</small>
            </span>
          </Link>

          <Nav />

          <div className="who">
            <span>
              {session.email} · {ROLE_LABELS[session.role]}
            </span>
            <form action={signOut}>
              <button type="submit" className="linkish">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="wrap" id="main">
        {children}
      </main>
    </div>
  );
}
