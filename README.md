# Grantboard

A grant pipeline and application-drafting tool for a small nonprofit youth
theater. Built for a volunteer board and a very small staff, most of whom will
open it on a phone.

Next.js 15 (App Router, TypeScript) · Supabase (Postgres, auth, row-level
security) · Anthropic API for drafting · deploys to Vercel.

It is multi-tenant from the first migration: a second organization is a row in
`orgs`, not a second deployment.

---

## What you need

- A [Supabase](https://supabase.com) account (the free tier is enough)
- A [Vercel](https://vercel.com) account
- An [Anthropic API key](https://console.anthropic.com)
- A GitHub account with this repository

Everything below is done in the browser. There is no local development step.

---

## 1. Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click
   **New project**.
2. Name it something like `grantboard`, choose a region near you (US West for
   Spokane), and set a database password. Save that password somewhere safe —
   you will not need it for this app, but you will want it eventually.
3. Wait for the project to finish provisioning, about two minutes.

## 2. Run the migrations

1. In the Supabase dashboard, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Run every file in `supabase/migrations/` **in filename order**, one at a
   time — currently `0001_init.sql` then `0002_harden_function_grants.sql`.
   Copy the whole file, paste, click **Run**.

Each should report `Success. No rows returned`. `0001` creates every table, the
three roles, the row-level security policies, and the trigger that turns an
invite into a membership. `0002` tightens function privileges — see the comment
at the top of that file for why it is a separate step and why it matters.

Migrations run **once**, in order. Do not re-run `0001` against a database that
already has it.

## 3. Run the seed

1. Still in the SQL Editor, click **New query** again.
2. Copy all of `supabase/seed.sql` and paste it in.
3. Click **Run**.

This loads the organization profile, six years of Form 990 history, the board
roster, three real funding opportunities, and the answer library.

The seed is safe to run more than once — every insert is idempotent, so a
second run changes nothing.

## 4. Configure email sign-in

1. Open **Authentication → Providers** and confirm **Email** is enabled.
2. Turn **Confirm email** on and leave passwords disabled — this app uses magic
   links only, so there is no password for a volunteer board to lose.
3. Open **Authentication → URL Configuration** and set:
   - **Site URL** — your Vercel URL, e.g. `https://grantboard.vercel.app`
   - **Redirect URLs** — add `https://your-app.vercel.app/auth/callback` and
     `https://your-app.vercel.app/auth/confirm`

   Add both. Which one Supabase uses depends on your email template, and having
   the unused one listed costs nothing.

> Supabase's built-in email sender is rate-limited to a handful of messages an
> hour, which is fine for a board of eight. If you outgrow it, add an SMTP
> provider under **Authentication → Emails**.

## 5. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this repository.
2. Vercel will detect Next.js on its own. Leave the build settings alone.
3. Add these environment variables before deploying:

   | Name | Where to find it | Exposed to the browser? |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Yes |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public | Yes |
   | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | **No — server only** |

   The first two are *meant* to be public; row-level security is what protects
   your data, not the anon key. `ANTHROPIC_API_KEY` is different. It has no
   `NEXT_PUBLIC_` prefix on purpose, it is read only inside `/api/draft`, and it
   must never gain that prefix — that would ship your billable key to every
   visitor's browser.

4. **Set the two `NEXT_PUBLIC_` variables to type `Config`, not `Secret`.**
   This one is easy to get wrong and the failure is confusing.

   Vercel's newer variable types are not interchangeable. `Secret` values are
   write-only and injected at *runtime*. But `NEXT_PUBLIC_*` variables have to
   exist at *build* time, because Next.js inlines them into the bundle during
   `next build` rather than reading them per request. Marked `Secret`, they are
   simply absent when the build runs, `process.env.NEXT_PUBLIC_SUPABASE_URL`
   compiles to `undefined`, and every page fails with:

   > Application error: a server-side exception has occurred

   The runtime logs show the real message — "Supabase is not configured" — which
   is misleading, because the variables genuinely exist in project settings. The
   type is what is wrong. Vercel flags this with a small warning icon next to the
   variable name.

   `ANTHROPIC_API_KEY` should stay `Secret`. It is server-only and never inlined.

   Note that Vercel's import flow may pre-create these three names from
   `.env.example` and default them all to `Secret`. If you did not add them
   yourself, assume the values are placeholders and replace them.

5. Deploy, then go back to step 4 and make sure the Site URL matches the URL
   Vercel actually gave you.

   **After changing any environment variable, redeploy with "Use existing Build
   Cache" unticked.** Vercel does not apply new variables to an existing
   deployment, and a cached build can carry the old inlined `undefined` straight
   through.

## 6. Make yourself an admin

The invite trigger only fires for people who already have an invite waiting, and
right now nobody does — including you. Bootstrap yourself once, by hand.

**First, sign in.** Open your deployed app, enter your email, and click the link
you get. You will land on a screen saying you are not on a roster yet. That is
expected — signing in is what creates your user record.

**Then, in the Supabase SQL Editor**, run this with your own email:

```sql
insert into public.memberships (org_id, user_id, role)
select
  (select id from public.orgs where slug = 'cyt-spokane'),
  (select id from auth.users where email = 'you@example.org'),
  'admin'
on conflict (org_id, user_id) do update set role = 'admin';
```

Reload the app. You are in, as an admin.

## 7. Invite everyone else

From then on, nobody touches SQL. As an admin, add a row to `invites` for each
person:

```sql
insert into public.invites (org_id, email, role) values
  ((select id from public.orgs where slug = 'cyt-spokane'), 'director@example.org', 'staff'),
  ((select id from public.orgs where slug = 'cyt-spokane'), 'chair@example.org',    'board');
```

The next time each person signs in with a magic link, the trigger on
`auth.users` converts their invite into a membership automatically. Email
matching is case-insensitive.

---

## 8. The weekly funder-page watcher (optional)

Deadlines in this app go stale quietly. A funder moves their page, the date you
recorded last year stops being true, and nothing tells you — because nobody
re-reads a page without a reason to.

The watcher is that reason. Once a week it fetches the URL behind each tracked
opportunity, compares the page's text to what it saw last time, and flags the
ones that changed. **It does not read the page.** It cannot tell you what
changed or what the new deadline is; it can only tell you to go look. That
restriction is deliberate and it is enforced in the database, not just in the
code — see "What the watcher cannot do" below.

It is entirely optional. Skip this section and the rest of the app works
exactly as before.

### Create the machine account

The watcher signs in as a normal Supabase user. In **Authentication → Users →
Add user**, create one with a real address you control and a long random
password. Tick *Auto Confirm User* so it never needs to click an email link.

Then register it as a watch agent — note that it gets **no membership**:

```sql
insert into public.watch_agents (user_id, org_id, label)
values (
  (select id from auth.users where email = 'watcher@yourdomain.org'),
  (select id from public.orgs where slug = 'cyt-spokane'),
  'Weekly funder page watcher'
);
```

### Add the secrets

Generate a shared secret:

```bash
openssl rand -hex 32
```

In **Vercel → Settings → Environment Variables**, add three. All three are
server-side only, so unlike the `NEXT_PUBLIC_*` pair these may be type *Secret*:

| Name | Value |
|---|---|
| `CRON_SECRET` | the random string you just generated |
| `WATCH_AGENT_EMAIL` | the machine account's address |
| `WATCH_AGENT_PASSWORD` | its password |

Redeploy so the new variables are picked up.

In **GitHub → Settings → Secrets and variables → Actions**, add two:

| Name | Value |
|---|---|
| `CRON_SECRET` | the same random string |
| `WATCH_ENDPOINT_URL` | `https://your-app.vercel.app/api/cron/scan` |

### Run it

`.github/workflows/watch.yml` runs Mondays at 15:00 UTC — 8am Pacific in
summer, 7am in winter. To run it immediately, go to **Actions → Watch funder
pages → Run workflow**. The run summary reports how many pages were checked,
how many changed, and how many could not be fetched.

The first run records a baseline for every page and reports no changes, because
there is nothing yet to compare against. Real findings start the week after.

### What you will see

A changed page raises a banner on the callboard and on that opportunity, in
brass — the same colour as an estimated date, because it makes the same claim:
*something here has not been checked by a person.* Staff clear it with
**I've re-read the page**.

Clearing it records only that someone looked. It deliberately does not mark the
record verified or confirm the deadline — those are the separate Verify action,
which asks explicitly. "I glanced at the page" and "I confirmed this date" are
different statements and the app keeps them apart.

### What the watcher cannot do

The machine account has no membership, so the existing policies stop it without
anyone having to trust the code:

- It **cannot set `verified`**, move a deadline, or edit eligibility text —
  `opportunities_update` requires a membership it does not have.
- It **cannot create an opportunity**.
- It **cannot read** applications, drafts, 990 figures, contacts or the answer
  library — every one of those policies asks for a membership too.
- It **cannot clear its own flag**. A watcher that could acknowledge its own
  finding would look identical to one that never raised it, so a trigger
  refuses the write.

All of that is asserted in `supabase/tests/02_rls_test.sql`, and the assertion
that matters most is named after the reason it exists: *the watcher CANNOT set
verified, which is the whole point of it.*

### Its limits, honestly

- It compares **text**, so a funder who rewrites their boilerplate, rotates a
  quotation or adds a news item will flag as changed with no grant news at all.
  False positives are the intended failure direction: a watcher that misses a
  real change is worse than one that occasionally wastes a click.
- It **cannot see pages that render in JavaScript**. Those return almost no
  readable text, and rather than hash an empty page forever and report a
  reassuring "unchanged", it records an error asking you to check by hand.
- It only watches opportunities that **have a URL**. One without a URL is
  invisible to it, and says so on the opportunity page.

---

## The three roles

| Role | Can do |
|---|---|
| **board** | Read the pipeline, opportunities, org profile, drafts and answer library |
| **staff** | Everything board can, plus write drafts, add and verify opportunities, edit the answer library |
| **admin** | Everything staff can, plus financial documents, 990 records, and managing members |

These are enforced by row-level security policies in Postgres, not by hiding
buttons. A board member calling the API directly still cannot write a draft.

## Local development, if you ever want it

```bash
npm install
cp .env.example .env.local   # then fill in the three values
npm run dev
```

## Tests

CI runs on every push and pull request (`.github/workflows/ci.yml`), in two jobs:

- **Typecheck and build** — `tsc --noEmit` and `next build`
- **Schema, seed and RLS policies** — applies the migration and seed to a
  throwaway Postgres, then asserts what each role can and cannot do

The second job is the one worth knowing about. "Enforced by row-level security,
not UI checks" is a claim about access control, and this is what re-checks it:
it acts as a real board, staff and admin user and asserts, among other things,
that a board account cannot write a draft, that another organization's rows are
invisible even when the exact id is known, and that an answer edited by a person
cannot stay labelled as an unread machine draft.

To run it against your own Postgres:

```bash
npm run test:db     # uses the standard PGHOST/PGPORT/PGUSER/PGPASSWORD vars
```

The runner creates and drops its own scratch database each time, so it is safe
to re-run. `GRANTBOARD_KEEP_DB=1` leaves the database behind if you want to
inspect a failure.

These tests are not run against your real Supabase project and never touch it.

The harness deliberately replicates Supabase's default privileges (which grant
`EXECUTE` on new `public` functions to `anon` and `authenticated`). That detail
is load-bearing: without it the privilege assertions pass vacuously while a real
project stays exposed, which is exactly how the gap that `0002` fixes was missed
locally and caught later by Supabase's own linter.

## Two things this app will not do

**It will not submit anything.** Submittable, Foundant, Fluxx and Grants.gov
have no third-party submission API. There is no submit button and there never
will be one. Grantboard drafts the answers and exports a field-mapped packet;
a person pastes it into the funder's portal and submits it there.

**It will not invent a fact to fill a gap.** Where a number is unknown, drafts
carry `[CONFIRM: ...]` markers instead of a plausible-looking figure. Those
markers are the product working correctly. Resolve them with real numbers from
staff records.
