import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/env";
import { fetchPageState } from "@/lib/watch";

// Needs Node for node:crypto and for outbound fetches with generous timeouts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pages per run. See the ordering note below — runs make progress in turn. */
const DEFAULT_LIMIT = 25;

/** Politeness gap between requests to (often) the same small funder host. */
const DELAY_MS = 750;

type WatchTarget = {
  id: string;
  org_id: string;
  url: string;
  funder_name: string;
};

type WatchRow = {
  opportunity_id: string;
  url: string;
  content_hash: string | null;
  consecutive_failures: number;
};

/**
 * POST /api/cron/scan
 *
 * Re-fetches the funder pages behind tracked opportunities and records which
 * ones changed. Scheduled weekly from GitHub Actions; also safe to run by hand.
 *
 * It writes to `opportunity_watch` and nothing else. It cannot write to
 * `opportunities` — not because this code declines to, but because the account
 * it signs in as has no membership, and `opportunities_update` requires one.
 * See 0004_page_watch.sql.
 *
 * There is still no service-role client in this codebase. This route signs in
 * as an ordinary user — a machine account registered in `watch_agents` — so its
 * queries run under RLS exactly like a person's do. If this route ever appears
 * to need a service key, the policy is wrong.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on the server." },
      { status: 503 },
    );
  }

  if (!isAuthorized(request, secret)) {
    // Deliberately terse: an unauthenticated caller learns nothing about
    // whether the endpoint, the org or the schedule exists.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const email = process.env.WATCH_AGENT_EMAIL;
  const password = process.env.WATCH_AGENT_PASSWORD;
  if (!email || !password) {
    return NextResponse.json(
      {
        error:
          "The watcher is not configured: set WATCH_AGENT_EMAIL and " +
          "WATCH_AGENT_PASSWORD to the machine account registered in watch_agents.",
      },
      { status: 503 },
    );
  }

  const { url: supabaseUrl, anonKey } = supabaseEnv();

  // A standalone client: no cookies, no shared session. persistSession is off
  // because a serverless instance is not a browser and must not carry one
  // invocation's session into the next.
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return NextResponse.json(
      { error: `The watch agent could not sign in: ${signInError.message}` },
      { status: 502 },
    );
  }

  try {
    return await scan(supabase, requestedLimit(request));
  } finally {
    await supabase.auth.signOut();
  }
}

async function scan(supabase: SupabaseClient, limit: number): Promise<NextResponse> {
  // RLS decides which opportunities come back: exactly those belonging to orgs
  // this agent is registered for. No org filter is applied here, and none is
  // needed — asking for everything returns only what the agent may see, which
  // is also how a second organization starts being watched without a code
  // change.
  const { data: opportunities, error: readError } = await supabase
    .from("opportunities")
    .select("id, org_id, url, funder_name")
    .not("url", "is", null);

  if (readError) {
    return NextResponse.json(
      { error: `Could not read opportunities: ${readError.message}` },
      { status: 502 },
    );
  }

  const { data: existing, error: watchError } = await supabase
    .from("opportunity_watch")
    .select("opportunity_id, url, content_hash, consecutive_failures");

  if (watchError) {
    return NextResponse.json(
      { error: `Could not read watch state: ${watchError.message}` },
      { status: 502 },
    );
  }

  const priorByOpportunity = new Map<string, WatchRow>(
    ((existing ?? []) as unknown as WatchRow[]).map((row) => [row.opportunity_id, row]),
  );

  // Never-checked pages first, then least-recently-checked. A run that hits the
  // function time limit therefore leaves different work for next time instead
  // of re-checking the same first few pages forever.
  const queue = ((opportunities ?? []) as unknown as WatchTarget[])
    .filter((o) => typeof o.url === "string" && o.url.length > 0)
    .sort((a, b) => {
      const aSeen = priorByOpportunity.has(a.id) ? 1 : 0;
      const bSeen = priorByOpportunity.has(b.id) ? 1 : 0;
      return aSeen - bSeen;
    })
    .slice(0, limit);

  const now = new Date().toISOString();
  const results: Array<Record<string, unknown>> = [];
  let changed = 0;
  let failed = 0;

  for (const [index, opportunity] of queue.entries()) {
    if (index > 0) await sleep(DELAY_MS);

    const prior = priorByOpportunity.get(opportunity.id);
    const outcome = await fetchPageState(opportunity.url);

    // A staff member editing the URL means the old hash describes a different
    // document. Treat it as a new baseline rather than reporting a change that
    // only reflects our own edit.
    const sameUrlAsBefore = prior?.url === opportunity.url;
    const baseline = sameUrlAsBefore ? prior?.content_hash ?? null : null;

    if (!outcome.ok) {
      failed += 1;
      await supabase.from("opportunity_watch").upsert(
        {
          opportunity_id: opportunity.id,
          org_id: opportunity.org_id,
          url: opportunity.url,
          last_checked_at: now,
          last_status: outcome.status,
          last_error: outcome.error,
          consecutive_failures: (sameUrlAsBefore ? prior?.consecutive_failures ?? 0 : 0) + 1,
        },
        { onConflict: "opportunity_id" },
      );

      results.push({
        funder: opportunity.funder_name,
        url: opportunity.url,
        outcome: "failed",
        detail: outcome.error,
      });
      continue;
    }

    const isChange = baseline !== null && baseline !== outcome.hash;
    if (isChange) changed += 1;

    await supabase.from("opportunity_watch").upsert(
      {
        opportunity_id: opportunity.id,
        org_id: opportunity.org_id,
        url: opportunity.url,
        content_hash: outcome.hash,
        content_length: outcome.length,
        last_checked_at: now,
        last_status: outcome.status,
        last_error: null,
        consecutive_failures: 0,
        // Preserved on an unchanged page; bumped on a real change, which is
        // what makes a stale acknowledgement stop counting.
        ...(isChange ? { last_changed_at: now } : {}),
      },
      { onConflict: "opportunity_id" },
    );

    results.push({
      funder: opportunity.funder_name,
      url: opportunity.url,
      outcome: baseline === null ? "baseline recorded" : isChange ? "CHANGED" : "unchanged",
    });
  }

  return NextResponse.json({
    checked: queue.length,
    changed,
    failed,
    remaining: Math.max(0, (opportunities ?? []).length - queue.length),
    results,
  });
}

/**
 * Compare the bearer token without leaking its length or content through timing.
 */
function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requestedLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
