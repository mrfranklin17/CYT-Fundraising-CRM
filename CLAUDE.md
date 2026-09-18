# Grantboard — working notes

Context for anyone, human or model, picking this codebase up.

## What this is

A grant pipeline and application-drafting tool for Christian Youth Theater –
Spokane, a small nonprofit youth theater. The users are a volunteer board and a
very small staff. Most are non-technical and will open this on a phone.

Multi-tenant from the first migration. Every org-owned row carries `org_id` and
every policy is written against it. A second organization is a row in `orgs`,
never a second deployment. Do not add a query that assumes one org.

## The standing rule

**A record with `verified = false` has not been checked against the funder's
page. It must never be silently "completed" with a plausible-looking deadline.**

This is the rule that matters most, and it is the easiest one to break while
being helpful. If a deadline is missing, wrong-looking, or stale, the correct
actions are:

- Leave it as it is and leave `deadline_estimated = true`, or
- Have a person open the funder's page, read the real date, then set
  `verified = true` and `deadline_estimated = false`.

The incorrect action — and it will feel like tidying up — is to replace a
projection with a different projection, fill a blank with a date that matches
the pattern, or flip `verified` because the record now looks complete. A
deadline that is wrong but confident is worse than one that is visibly
uncertain, because the second one gets checked and the first one gets planned
around. The same applies to `eligibility`: it holds the funder's own words,
quoted. Never summarize into that column, and never let a model paraphrase it.

## The weekly watcher

`.github/workflows/watch.yml` calls `POST /api/cron/scan` once a week. It
re-fetches the URL behind each tracked opportunity, hashes the page's extracted
text, and flags the ones that differ from last time.

It exists because of the standing rule above, not in tension with it. The rule
says a stale deadline must not be quietly replaced with a plausible one, which
leaves an obvious gap: nothing was telling anyone a deadline had gone stale.
The watcher closes that gap in the only way that does not reintroduce the
problem — by raising a flag instead of producing a date.

So it reports *that* a page changed and never *what* it now says. It does not
parse deadlines, does not read eligibility, and does not call a model. There is
no code path from a fetched page to an `opportunities` column, and there should
never be one. `ANTHROPIC_API_KEY` is still read in `/api/draft` and nowhere
else.

**There is still no service-role client.** The watcher signs in as a machine
account — a real `auth.users` row registered in `watch_agents` — so its queries
run under RLS like anyone's. It has deliberately **no membership**, and that is
the whole enforcement mechanism: the narrowest human role that can create an
opportunity is `staff`, and `staff` can also set `verified`. Giving a fetcher
that combination is precisely the failure the standing rule exists to prevent.
Without a membership it cannot write to `opportunities` at all, and cannot read
applications, drafts, financials, contacts or the answer library.

A trigger also stops the watcher writing `acknowledged_at`. A watcher that
could clear its own flag would be indistinguishable from one that never raised
it.

If you extend this, the test to watch is the one named after its own purpose:
*the watcher CANNOT set verified, which is the whole point of it.*

## Role model

Three roles, as a Postgres enum (`org_role`):

- **board** — reads the pipeline
- **staff** — also writes drafts, adds and verifies opportunities, edits the
  answer library
- **admin** — also financial documents, 990 records, member management

Enforced by RLS policies, not UI checks. The UI hides buttons as a courtesy;
the database is what stops a board member from writing a draft by calling
PostgREST directly. If you add a table, add its policies in the same migration
— and add a test for them in `supabase/tests/02_rls_test.sql`. A policy with no
test is a claim nobody re-checks; CI runs that file on every push.

Policies use two `SECURITY DEFINER` helpers, `has_org_access(org_id)` and
`has_org_role(org_id, roles[])`. They exist so that a policy on `memberships`
can ask "is this user a member?" without re-entering `memberships` policies and
recursing forever. Their `search_path` is pinned. Do not rewrite a policy to
query `memberships` inline.

There is no service-role client anywhere in this codebase, deliberately. Every
server-side query runs under the signed-in user's own RLS context. If something
seems to need a service key, the policy is wrong — fix the policy.

## Keep the test harness faithful to Supabase

`supabase/tests/00_harness.sql` stands in for the parts of a Supabase project
the migrations depend on. Anywhere it is *more restrictive* than the real
platform, the suite passes while production is exposed.

This is not hypothetical. Supabase applies default privileges granting `EXECUTE`
on every new `public` function to `anon` and `authenticated`. `0001`'s
`revoke all ... from public` does not undo that, because revoking from PUBLIC
leaves an explicit per-role grant in place — so the SECURITY DEFINER helpers
shipped callable by `anon`. The harness had no such default privileges, so the
suite showed clean; Supabase's own linter caught it against a live project.
`0002_harden_function_grants.sql` is the fix, and the harness now replicates the
default privileges so the assertions actually bite.

It happened a second time, in the same direction, when `0004` was added. The
harness replicated Supabase's default privileges for *functions* but not for
*tables* — and Supabase grants ALL privileges on every new `public` table to
`anon` and `authenticated` as it is created. So `0001`'s carefully narrow
grants were additions to a full grant rather than a description of it, and two
intentions had been silently lost in the live project:

- `activity_log` was granted `insert` only, because it is append-only. In
  production `authenticated` also held `update` and `delete` on it. Nothing
  could actually be rewritten — there is no update or delete policy, so those
  statements matched zero rows — but the append-only guarantee was resting on
  one layer instead of two.
- `TRUNCATE` was never intended anywhere, and `authenticated` held it on all
  twelve tables. **`TRUNCATE` is not subject to row-level security**, so it is
  not something a policy can contain.

`0004` restates the whole grant block to fix both, and the harness now
replicates table default privileges so the assertions covering it can fail.
The test that caught it was an existing one — *nobody can rewrite the activity
log* — which had been passing because of a grant-level rejection that only ever
existed in the harness.

When you add something to the harness, ask which direction the inaccuracy runs.
Too permissive produces false alarms you will notice. Too restrictive produces
silence you will not.

## Answer provenance

`application_questions.source` is `empty`, `ai_draft`, or `human`.

It is not something the client asserts by setting a column. A database trigger
decides: the drafting endpoint stamps `drafted_at` in the same statement as the
text, and that pairing is the only way a row earns `ai_draft`. Any other change
to the text is a person typing, so the row becomes `human`. Text that has not
changed cannot be relabeled at all.

The point is that nobody should be able to submit words nobody has read.
Preserve that property. The cases are covered in `supabase/tests/02_rls_test.sql`:
a fresh draft marks `ai_draft`; a human edit flips to `human`; re-drafting an
existing draft stays `ai_draft`; a client cannot relabel reviewed prose as a
draft; a client cannot claim `ai_draft` for text it typed itself; blanking an
answer returns it to `empty`.

The re-draft case is there because the first version of this trigger got it
wrong and marked unread machine text as human-reviewed. If you change the
trigger, that test is the one to watch.

## Drafting

`POST /api/draft`, Node runtime, takes **only** a `questionId`. Everything else
— org profile, three most recent 990 years, board roster, answer library,
funder's quoted eligibility — is fetched server-side under the caller's own RLS
context. Passing someone else's `questionId` returns 404 because the row is
invisible to that user, not because we compared an id against a list. Keep it
that way: do not add fields to the request body that the server could fetch
itself.

`ANTHROPIC_API_KEY` is read in that route and nowhere else. It has no
`NEXT_PUBLIC_` prefix and must never get one.

The model is `claude-sonnet-5`. The system prompt is in `src/lib/drafting.ts`
and its rules are load-bearing, not boilerplate:

- Use only the facts provided.
- Never invent numbers, dates, participant counts, outcomes or partner names.
- Write `[CONFIRM: what's needed]` inline where a figure is missing.
- If the funder's eligibility language rules out what's being proposed, say so
  rather than drafting around it.

A `[CONFIRM: ...]` marker in a draft is the system working. Do not "improve"
the prompt by softening those rules, and do not write code that strips the
markers before export — the export deliberately counts them and warns.

## No submit button

There is no submit button and there never will be. Submittable, Foundant, Fluxx
and Grants.gov have no third-party submission API. Grantboard exports a
field-mapped text packet that staff paste into the funder's portal, and the UI
says so plainly so nobody plans around one-click submission that cannot exist.

If someone asks for a submit button, the answer is an explanation, not a
feature.

## Built

- Schema, RLS policies, invite trigger, provenance trigger
  (`supabase/migrations/0001_init.sql`)
- Function privilege hardening (`supabase/migrations/0002_harden_function_grants.sql`)
- Seed data, all real and sourced (`supabase/seed.sql`)
- Magic-link auth, session-refreshing middleware, friendly no-membership screen
- Callboard with counts, unverified banner, deadline-ordered strips
- Opportunities list and detail, with eligibility quoted prominently
- Org profile: identity, mission, 990 table, board roster
- Draft editor: per-question drafting, draft-all-blanks, text export
- Answer library, editable by staff
- `POST /api/draft`
- Weekly funder-page watcher: `watch_agents`, `opportunity_watch`, machine-account
  auth, `POST /api/cron/scan`, callboard and detail banners
  (`supabase/migrations/0004_page_watch.sql`, `.github/workflows/watch.yml`)
- CI (`.github/workflows/ci.yml`): typecheck + build, and a Postgres job that
  applies the migration and seed to a throwaway database and asserts the
  policies (`supabase/tests/`, or `npm run test:db` locally), plus unit tests for
  the watcher's change detection on Node's own runner (`npm run test:unit`)

## Not built

- Document upload. The `documents` table and its policies exist; there is no
  Supabase Storage bucket or upload UI yet.
- Contacts UI. The table and policies exist; nothing reads them.
- Activity log UI. Rows are written; nothing displays them. The table is
  append-only by design — there is no update or delete policy, so nobody can
  rewrite the record of who drafted what. Keep it that way.
- Member management UI. Admins invite by inserting into `invites` via SQL (see
  README).
- Org switcher. `requireSession()` returns the user's first membership. When a
  second organization joins, that function is where the switcher goes.
- Opportunity *discovery*. The watcher only re-checks funders already in the
  pipeline; nothing finds new ones. The intended shape is a separate candidates
  inbox that staff promote from, fed by structured sources (Grants.gov,
  ProPublica's 990 API) — never by a model reading a page. Anything auto-created
  must land `verified = false`, `deadline_estimated = true`, with `eligibility`
  left null unless it is a verbatim quote captured with its source URL.
- Per-funder question templates. New applications get a generic starter set
  from `DEFAULT_QUESTIONS`; staff edit the prompts to match the real portal.

## Design

Theater-grounded, not generic SaaS. House blue `#1B1F3B`, brass `#C08A2E`,
curtain red `#9B2F35` for urgency, warm paper `#F6F5F2`. Fraunces for headings,
Instrument Sans for UI. Opportunities are horizontal strips with a left color
bar encoding deadline urgency — deliberately not identical rounded cards,
because a callboard is a list you scan. Dark mode via `prefers-color-scheme`,
visible keyboard focus, phone-first.

**Do not reproduce the CYT logo.** It is trademarked by CYT National, and
Spokane is a licensed affiliate. The app uses a wordmark. `.logo-slot` in
`globals.css` is the hook for dropping in an approved file if the organization
supplies one.

## A note on the seed data

Everything in `supabase/seed.sql` is real: the EIN, the 990 figures, the board
roster, the funder deadlines and the quoted eligibility language. Where CYT's
own numbers are unknown — enrollment, scholarships, demographics, audience
attendance — the entries say `[CONFIRM: ...]` instead of a number.

Do not fill those in to make the app demo better. They flow into grant
applications that go to funders over a nonprofit's signature.
