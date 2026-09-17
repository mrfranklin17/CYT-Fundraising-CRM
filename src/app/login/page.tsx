import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · Grantboard" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="centered">
      <div className="card">
        <p className="eyebrow">Grantboard</p>
        <h1>Sign in</h1>
        <p className="lede">
          Enter the email address your organization invited. We will send you a
          link that signs you in — there is no password to remember.
        </p>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
