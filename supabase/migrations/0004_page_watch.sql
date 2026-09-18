-- Funder page watching.
--
-- The problem this solves is the one `deadline_estimated` names: a deadline in
-- this pipeline can go stale without anyone noticing, because nothing tells you
-- the funder moved their page. A person only re-reads a page when something
-- prompts them to.
--
-- So this is a watcher, not a scraper. It fetches the pages we already track,
-- notices that the text changed, and raises a flag saying "go look". It does
-- not parse a deadline, it does not read eligibility, and it does not write to
-- `opportunities` at all. Those three restrictions are enforced here, in the
-- policies, rather than left to the good behaviour of the code that calls them.
--
-- The standing rule from CLAUDE.md applies with full force: a record with
-- `verified = false` has not been checked against the funder's page. Nothing
-- automated may flip that bit. The schema below makes that structurally true —
-- the watcher has no membership, and `opportunities_update` requires one.

-- ---------------------------------------------------------------------------
-- Who is allowed to watch
-- ---------------------------------------------------------------------------

-- A watch agent is a machine account: a real row in auth.users that a scheduled
-- job signs in as. It is deliberately NOT a membership.
--
-- A membership would have been the obvious move, and it would have been wrong.
-- The narrowest human role that can create an opportunity is `staff`, and
-- `staff` can also set `verified = true`. Giving a fetcher that power is exactly
-- the failure the standing rule exists to prevent. So the watcher sits outside
-- the role model entirely and is granted two capabilities and no others:
-- read the opportunity list, and write down what it saw.
create table public.watch_agents (
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references public.orgs(id) on delete cascade,

  -- Free text for humans reading the table later: what this account is, who
  -- set it up. A machine account with no explanation gets deleted by a future
  -- admin who cannot tell what it was for.
  label      text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,

  primary key (user_id, org_id)
);

comment on table public.watch_agents is
  'Machine accounts permitted to record page-watch observations for an org. Deliberately not memberships: a watcher must not inherit staff''s ability to set opportunities.verified.';

-- Mirrors has_org_access/has_org_role: SECURITY DEFINER so that a policy can
-- ask "is the caller an agent?" without the caller needing to read
-- watch_agents, and with search_path pinned so the definer's rights cannot be
-- redirected at a table of someone else's choosing.
create or replace function public.is_watch_agent(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.watch_agents a
    where a.org_id = target_org and a.user_id = auth.uid()
  );
$$;

comment on function public.is_watch_agent(uuid) is
  'True when the caller is a registered watch agent for the org. Used by policies so a watcher needs no membership.';

-- ---------------------------------------------------------------------------
-- What the watcher records
-- ---------------------------------------------------------------------------

create table public.opportunity_watch (
  opportunity_id uuid primary key
                 references public.opportunities(id) on delete cascade,
  org_id         uuid not null references public.orgs(id) on delete cascade,

  -- The URL as it was actually fetched. Kept alongside the hash because
  -- `opportunities.url` can be edited, and a hash taken from a different page
  -- than the one now recorded would compare two unrelated documents and report
  -- a change that means nothing.
  url            text not null,

  -- sha256 of the page's extracted, whitespace-collapsed text. Not of the raw
  -- HTML: markup churns on every deploy of the funder's own site, and a watcher
  -- that cries wolf weekly gets ignored, which leaves the pipeline exactly as
  -- stale as it was before anyone built this.
  content_hash   text,
  content_length integer,

  last_checked_at timestamptz,
  last_changed_at timestamptz,

  -- Last transport outcome. A page that has started 404ing is itself worth
  -- knowing about — a moved grant program is a deadline change in disguise.
  last_status     integer,
  last_error      text,
  consecutive_failures integer not null default 0,

  -- Set by a person once they have re-read the page. The flag is raised by
  -- `last_changed_at` and cleared by this being at or after it, so an
  -- acknowledgement never survives a subsequent change.
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.opportunity_watch is
  'One row per watched opportunity URL. Records that a page changed; deliberately records nothing about what it now says.';
comment on column public.opportunity_watch.content_hash is
  'sha256 of extracted text, not raw HTML, so that markup churn does not read as a content change.';
comment on column public.opportunity_watch.acknowledged_at is
  'When a person last re-read the page. Needs attention while this is null or older than last_changed_at.';

create index opportunity_watch_org_idx on public.opportunity_watch (org_id);
create index opportunity_watch_attention_idx
  on public.opportunity_watch (org_id, last_changed_at)
  where last_changed_at is not null;

create trigger opportunity_watch_touch
  before update on public.opportunity_watch
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Column scope: the watcher observes, a person acknowledges
-- ---------------------------------------------------------------------------

-- RLS decides which rows a caller may write, not which columns. Both the
-- watcher and a staff member can legitimately update the same row, but for
-- opposite halves of it, so the split is enforced here.
--
-- The important half is the first branch. A watcher that could write
-- `acknowledged_at` could raise a flag and immediately clear it, which would
-- look exactly like a well-behaved system and mean nothing at all.
create or replace function public.enforce_watch_write_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_watch_agent(new.org_id) then
    if new.acknowledged_at is distinct from old.acknowledged_at
       or new.acknowledged_by is distinct from old.acknowledged_by then
      raise exception 'A watch agent cannot acknowledge its own finding.'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if new.url            is distinct from old.url
       or new.content_hash   is distinct from old.content_hash
       or new.content_length is distinct from old.content_length
       or new.last_checked_at is distinct from old.last_checked_at
       or new.last_changed_at is distinct from old.last_changed_at
       or new.last_status     is distinct from old.last_status
       or new.last_error      is distinct from old.last_error
       or new.consecutive_failures is distinct from old.consecutive_failures then
      raise exception 'Only the watcher may change what the watcher observed.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger opportunity_watch_write_scope
  before update on public.opportunity_watch
  for each row execute function public.enforce_watch_write_scope();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.watch_agents      enable row level security;
alter table public.opportunity_watch enable row level security;

-- Members can see which machine accounts act for their org; only an admin can
-- appoint or remove one, the same bar as member management.
create policy watch_agents_select on public.watch_agents
  for select to authenticated
  using (public.has_org_access(org_id));

create policy watch_agents_insert on public.watch_agents
  for insert to authenticated
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));

create policy watch_agents_update on public.watch_agents
  for update to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));

create policy watch_agents_delete on public.watch_agents
  for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- Anyone in the org reads the watch state, including board members: "this page
-- moved" is pipeline information, which is what board is for.
create policy opportunity_watch_select on public.opportunity_watch
  for select to authenticated
  using (public.has_org_access(org_id) or public.is_watch_agent(org_id));

-- Only the watcher creates rows. A person has no reason to: the row is a record
-- of a fetch, and a person cannot perform one through this table.
create policy opportunity_watch_insert on public.opportunity_watch
  for insert to authenticated
  with check (public.is_watch_agent(org_id));

-- The watcher writes observations; staff and admin acknowledge them. Board is
-- deliberately absent — board reads the pipeline. The trigger above decides
-- which columns each side may actually touch.
create policy opportunity_watch_update on public.opportunity_watch
  for update to authenticated
  using (
    public.is_watch_agent(org_id)
    or public.has_org_role(org_id, array['staff','admin']::public.org_role[])
  )
  with check (
    public.is_watch_agent(org_id)
    or public.has_org_role(org_id, array['staff','admin']::public.org_role[])
  );

create policy opportunity_watch_delete on public.opportunity_watch
  for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- ---------------------------------------------------------------------------
-- The watcher's read access to opportunities
-- ---------------------------------------------------------------------------

-- The watcher needs the URL list and nothing else. Extending this one select
-- policy is the entire grant: it gains no access to applications, drafts,
-- financials, contacts or the answer library, because those policies still ask
-- for a membership it does not have.
--
-- `opportunities_insert`, `opportunities_update` and `opportunities_delete` are
-- deliberately left untouched. They require a membership, so the watcher cannot
-- create an opportunity, cannot edit a deadline, and cannot set `verified`.
drop policy opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities
  for select to authenticated
  using (public.has_org_access(org_id) or public.is_watch_agent(org_id));

-- ---------------------------------------------------------------------------
-- Function privileges
--
-- Same reasoning as 0002: Supabase's default privileges grant EXECUTE on every
-- new public function to anon and authenticated, and revoking from PUBLIC does
-- not undo a per-role grant. A SECURITY DEFINER function callable by anon is
-- reachable over PostgREST without a session.
-- ---------------------------------------------------------------------------

revoke all on function public.is_watch_agent(uuid) from public, anon;
grant execute on function public.is_watch_agent(uuid) to authenticated;

-- Fired by the system on update; no client role needs to call it directly.
revoke all on function public.enforce_watch_write_scope() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Table grants
--
-- RLS decides the rows; these grants decide who may attempt the statement at
-- all. This block restates every grant in the schema rather than only the two
-- new tables, because the grants 0001 wrote are not the grants the live project
-- has.
--
-- Supabase's default privileges grant ALL privileges on every new table in
-- `public` to `anon` and `authenticated` as the table is created. 0001's
-- narrower grants were therefore additions to a full grant, not a description
-- of it, and two intentions were silently lost:
--
--   * `activity_log` was granted INSERT only, deliberately, because the table
--     is append-only. In the live project `authenticated` also holds UPDATE and
--     DELETE on it. Nothing could actually be rewritten — there is no UPDATE or
--     DELETE policy, so those statements match zero rows — but the append-only
--     guarantee rested on RLS alone rather than on both layers.
--
--   * TRUNCATE was never intended anywhere, and `authenticated` holds it on all
--     twelve tables. TRUNCATE is NOT subject to row-level security. PostgREST
--     does not expose it, so this was not reachable, but "not reachable through
--     the API we currently use" is a weaker claim than the schema was making.
--
-- The harness hid both: it created no default privileges for tables, so the
-- suite saw exactly the grants 0001 wrote. 00_harness.sql now replicates them,
-- which is what turned this from an assumption into a failing test.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on schema public from anon;

grant usage on schema public to authenticated;

grant select on public.orgs, public.memberships, public.invites,
  public.org_financials, public.board_members, public.opportunities,
  public.applications, public.application_questions, public.answer_library,
  public.contacts, public.activity_log, public.documents,
  public.watch_agents, public.opportunity_watch
  to authenticated;

grant insert, update, delete on public.orgs, public.memberships, public.invites,
  public.org_financials, public.board_members, public.opportunities,
  public.applications, public.application_questions, public.answer_library,
  public.contacts, public.documents,
  public.watch_agents, public.opportunity_watch
  to authenticated;

-- Append-only, at the grant layer as well as the policy layer.
grant insert on public.activity_log to authenticated;
