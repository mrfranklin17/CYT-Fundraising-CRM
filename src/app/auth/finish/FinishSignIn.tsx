"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type State =
  | { status: "working" }
  | { status: "failed"; message: string; detail?: string };

export default function FinishSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<State>({ status: "working" });

  useEffect(() => {
    const next = searchParams.get("next") ?? "/";
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

    // The fragment is the only place left this could be.
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);

    const errorDescription =
      params.get("error_description") ??
      params.get("error_code") ??
      params.get("error");

    if (errorDescription) {
      setState({
        status: "failed",
        message: "That sign-in link did not work.",
        detail: errorDescription.replace(/\+/g, " "),
      });
      return;
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      setState({
        status: "failed",
        message: "That link did not carry a sign-in.",
        detail:
          "The link contained no credentials and no error. It may have been " +
          "opened a second time, or shortened or rewritten by a mail client.",
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (error) {
          setState({
            status: "failed",
            message: "That sign-in link did not work.",
            detail: error.message,
          });
          return;
        }
        // Clear the tokens out of the address bar before moving on.
        window.history.replaceState(null, "", window.location.pathname);
        router.replace(safeNext);
        router.refresh();
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "failed",
          message: "That sign-in link did not work.",
          detail:
            error instanceof Error ? error.message : "Unknown error.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (state.status === "working") {
    return (
      <>
        <h1>Signing you in…</h1>
        <p className="lede">One moment.</p>
      </>
    );
  }

  return (
    <>
      <h1>{state.message}</h1>
      <p className="lede">
        Sign-in links expire and can only be used once. Requesting a fresh one
        almost always fixes it.
      </p>
      {state.detail ? <p className="hint">Details: {state.detail}</p> : null}
      <p>
        <Link className="btn" href="/login">
          Get a new sign-in link
        </Link>
      </p>
    </>
  );
}
