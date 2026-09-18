import type { Metadata } from "next";
import { Suspense } from "react";
import FinishSignIn from "./FinishSignIn";

export const metadata: Metadata = { title: "Signing you in · Grantboard" };

/**
 * Completes a sign-in whose credentials arrived in the URL fragment.
 *
 * A fragment never reaches the server, so this has to happen in the browser.
 * /auth/callback sends anything it could not resolve server-side here.
 */
export default function AuthFinishPage() {
  return (
    <div className="centered">
      <div className="card">
        <p className="eyebrow">Grantboard</p>
        <Suspense
          fallback={
            <>
              <h1>Signing you in…</h1>
              <p className="lede">One moment.</p>
            </>
          }
        >
          <FinishSignIn />
        </Suspense>
      </div>
    </div>
  );
}
