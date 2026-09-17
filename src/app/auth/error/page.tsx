import Link from "next/link";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <div className="centered">
      <div className="card">
        <p className="eyebrow">Grantboard</p>
        <h1>That link did not work</h1>
        <p className="lede">
          Sign-in links expire and can only be used once. Opening one in a
          different browser than the one that requested it will also fail.
          Requesting a fresh link almost always fixes it.
        </p>
        {reason ? (
          <p className="hint">
            Details: {reason}
          </p>
        ) : null}
        <p>
          <Link className="btn" href="/login">
            Get a new sign-in link
          </Link>
        </p>
      </div>
    </div>
  );
}
