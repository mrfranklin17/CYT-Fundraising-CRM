"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");

    try {
      const supabase = createClient();
      const redirectTo = new URL("/auth/callback", window.location.origin);
      if (next) redirectTo.searchParams.set("next", next);

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo.toString() },
      });

      if (error) throw error;
      setState("sent");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong sending the link.",
      );
    }
  }

  if (state === "sent") {
    return (
      <div className="banner banner--ok" role="status">
        <h2>Check your email</h2>
        <p>
          We sent a sign-in link to <strong>{email}</strong>. It is good for one
          use. If it does not arrive in a minute or two, check your spam folder.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="field">
        <span>Email address</span>
        <input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          placeholder="you@example.org"
        />
      </label>

      {state === "error" ? (
        <div className="banner banner--error" role="alert">
          <p>{message}</p>
        </div>
      ) : null}

      <button className="btn" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
