import { createHash } from "node:crypto";

/**
 * Funder page watching.
 *
 * This module fetches a page and decides whether its text differs from the last
 * time we looked. That is the whole job. It deliberately does not parse a
 * deadline, does not read eligibility, and never returns anything that could be
 * written into an `opportunities` row.
 *
 * The reason is the standing rule in CLAUDE.md: a deadline that is wrong but
 * confident is worse than one that is visibly uncertain. A watcher that reads
 * "March 1" off a page and updates the record has replaced a projection a human
 * would have checked with a projection nobody will. A watcher that says "this
 * page changed, go look" cannot make that mistake, because it never produces a
 * date at all.
 */

/** Identifies the fetcher to funders whose logs a human may one day read. */
export const WATCH_USER_AGENT =
  "Grantboard page watcher (+https://github.com/mrfranklin17/CYT-Fundraising-CRM) " +
  "— weekly change detection for grant deadlines already tracked by this organization";

const FETCH_TIMEOUT_MS = 10_000;

/** Caps the page size we will hash, so one enormous page cannot stall a run. */
const MAX_BYTES = 2_000_000;

/**
 * Reduce an HTML document to the text a person would read.
 *
 * Hashing raw HTML does not work: funders' sites regenerate markup, rotate
 * CSRF tokens and reorder classes on every deploy, so the hash changes weekly
 * while the grant terms do not. A watcher that cries wolf every week gets
 * muted, which leaves the pipeline exactly as stale as it was before anyone
 * built this — so the noise floor matters more than the sensitivity.
 *
 * Note what is NOT stripped: numbers. It is tempting to filter out volatile
 * digits (visit counters, copyright years) to reduce false positives, and it
 * would be a mistake — dates and dollar amounts are digits, and they are the
 * entire signal.
 */
export function extractText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type FetchOutcome =
  | { ok: true; status: number; hash: string; length: number }
  | { ok: false; status: number | null; error: string };

/**
 * Fetch one page and reduce it to a hash of its readable text.
 *
 * Every failure mode returns rather than throws. One funder's site being down
 * must not end the run for the others, and a page that has started returning
 * 404 is itself worth recording: a grant program that moved is a deadline
 * change wearing a different hat.
 */
export async function fetchPageState(url: string): Promise<FetchOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: null, error: "Not a valid URL." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, status: null, error: `Unsupported scheme: ${parsed.protocol}` };
  }

  try {
    const response = await fetch(parsed, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": WATCH_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `${response.status} ${response.statusText}`.trim(),
      };
    }

    const body = await response.text();
    const text = extractText(body.slice(0, MAX_BYTES));

    // A page that reduces to almost nothing is usually a JavaScript shell or an
    // interstitial, not a grant page. Hashing it would produce a stable hash
    // that silently never changes — the worst outcome, because it looks like
    // everything is fine.
    if (text.length < 200) {
      return {
        ok: false,
        status: response.status,
        error:
          "Page returned almost no readable text — it may render client-side, " +
          "which this watcher cannot see. Check it by hand.",
      };
    }

    return { ok: true, status: response.status, hash: hashText(text), length: text.length };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `No response within ${FETCH_TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : "Unknown fetch failure.";
    return { ok: false, status: null, error: message };
  }
}
