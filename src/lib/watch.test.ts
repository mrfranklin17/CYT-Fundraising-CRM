import { test } from "node:test";
import assert from "node:assert/strict";
import { extractText, hashText } from "./watch.ts";

/**
 * Unit tests for the watcher's change detection.
 *
 * Run with `npm run test:unit`. No test framework: Node's own runner plus
 * type stripping, so this costs the project no dependency.
 *
 * What these protect is the signal-to-noise ratio, which is the difference
 * between a watcher people act on and one they mute. Two failure modes matter
 * and they pull in opposite directions:
 *
 *   * Flagging markup churn as a change produces a weekly false alarm. After a
 *     few of those nobody opens the banner, and the tool is worse than nothing
 *     because it looks like the deadlines are being watched.
 *   * Missing a real change is the failure the whole feature exists to prevent.
 *
 * Between the two, false positives are the acceptable direction.
 */

const filler = "Filler sentence that carries the page past the readable floor. ".repeat(4);

function fundersPage({ deadline = "March 1, 2027", nonce = "abc123" } = {}): string {
  return `<!DOCTYPE html><html><head>
    <meta name="csrf-token" content="${nonce}">
    <style>.headline{color:#b5811f} .a > .b{margin:0}</style>
    <script>window.__ANALYTICS__={loadedAt:"${nonce}"}; if (a > b) track("${nonce}");</script>
    </head><body>
    <!-- do not edit; see deploy > release notes, build ${nonce} -->
    <div class="layout-${nonce}">
      <h1>Spokane Arts &amp; Culture Grants</h1>
      <p>Applications are due ${deadline}. Awards range $1,000 to $5,000.</p>
      <p>Applicants must be &quot;arts-focused&quot; 501(c)(3) organizations.</p>
      <p>${filler}</p>
    </div></body></html>`;
}

test("markup churn does not read as a content change", () => {
  // Same words, different build: rotated CSRF token, regenerated class names,
  // a new analytics timestamp and a different build comment.
  const before = extractText(fundersPage({ nonce: "abc123" }));
  const after = extractText(fundersPage({ nonce: "zzz999" }));

  assert.equal(
    hashText(before),
    hashText(after),
    "a funder redeploying their site must not look like a changed deadline",
  );
});

test("a changed deadline is detected", () => {
  const before = extractText(fundersPage({ deadline: "March 1, 2027" }));
  const after = extractText(fundersPage({ deadline: "April 15, 2027" }));

  assert.notEqual(hashText(before), hashText(after));
});

test("digits are preserved", () => {
  // The tempting optimisation is to strip volatile numbers — visit counters,
  // copyright years — to cut false positives. Dates and dollar amounts are
  // digits too, and they are the entire signal.
  const text = extractText(fundersPage());

  assert.ok(text.includes("March 1, 2027"), "the deadline survived extraction");
  assert.ok(text.includes("$1,000"), "the award amount survived extraction");
});

test("scripts, styles and comments are removed", () => {
  // The fixture deliberately puts a `>` inside the script, the style and the
  // comment. Without one, the generic `<[^>]+>` tag strip removes them anyway
  // and this test passes whether or not the dedicated rules exist — which is
  // exactly what an earlier version of this fixture did.
  const text = extractText(fundersPage());

  assert.ok(!text.includes("__ANALYTICS__"), "script contents removed");
  assert.ok(!text.includes("#b5811f"), "style contents removed");
  assert.ok(!text.includes("release notes"), "comments removed");
});

test("common entities are decoded so they compare as text", () => {
  const text = extractText(fundersPage());

  assert.ok(text.includes("Arts & Culture"), "&amp; decoded");
  assert.ok(text.includes('"arts-focused"'), "&quot; decoded");
});

test("whitespace differences alone are not a change", () => {
  const a = extractText("<p>Deadline:   March 1</p>" + filler);
  const b = extractText("<p>Deadline:\n\n\tMarch 1</p>\n" + filler);

  assert.equal(hashText(a), hashText(b));
});

test("hashing is stable across calls", () => {
  const text = extractText(fundersPage());
  assert.equal(hashText(text), hashText(text));
});
