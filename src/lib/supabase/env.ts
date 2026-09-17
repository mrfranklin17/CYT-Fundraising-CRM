// Read once, in one place, so a missing variable fails with a sentence a
// volunteer admin can act on instead of a stack trace about `undefined`.
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in your Vercel project settings " +
        "(and in .env.local for local work), then redeploy.",
    );
  }

  return { url, anonKey };
}
