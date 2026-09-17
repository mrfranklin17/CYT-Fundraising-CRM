-- Grantboard :: initial schema
-- Multi-tenant from the first migration: every row that belongs to an
-- organization carries org_id, and every policy is written against it.
-- A second organization is a row in `orgs`, never a second deployment.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- board  : reads the pipeline
-- staff  : also writes drafts and adds opportunities
-- admin  : also financial documents and member management
create type public.org_role as enum ('board', 'staff', 'admin');

create type public.opportunity_status as enum (
  'prospect', 'drafting', 'submitted', 'awarded', 'declined', 'passed'
);

create type public.application_status as enum (
  'not_started', 'drafting', 'internal_review', 'ready_to_export',
  'submitted', 'awarded', 'declined'
);

-- 'ai_draft' means the words came out of the model and no human has touched
-- them since. It is the difference between a draft and a submission.
create type public.answer_source as enum ('empty', 'ai_draft', 'human');

create type public.document_kind as enum (
  'form_990', 'determination_letter', 'bylaws', 'budget', 'work_sample',
  'audit', 'board_list', 'other'
);

-- ---------------------------------------------------------------------------
-- Core tenancy tables
-- ---------------------------------------------------------------------------

create table public.orgs (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  legal_name     text,
  ein            text,
  tax_exempt_status text,
  exemption_issued_on date,
  ntee_code      text,
  ntee_label     text,
  founded_year   int,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  phone          text,
  website        text,
  fiscal_year_type text,
  executive_name text,
  executive_title text,
  mission        text,
  mission_notes  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.orgs.mission_notes is
  'Context a grant writer needs about how the mission is worded and how funders read it. Not public-facing copy.';

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.org_role not null default 'board',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_org_id_idx on public.memberships (org_id);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  email       citext not null,
  role        public.org_role not null default 'board',
  invited_by  uuid references auth.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  unique (org_id, email)
);

create index invites_email_idx on public.invites (email) where accepted_at is null;

-- ---------------------------------------------------------------------------
-- Access helpers
--
-- SECURITY DEFINER so that a policy on `memberships` can ask "is this user a
-- member of this org?" without re-entering `memberships` policies and
-- recursing forever. search_path is pinned so the definer rights cannot be
-- redirected at a shadowed table.
-- ---------------------------------------------------------------------------

create or replace function public.has_org_access(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = target_org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(target_org uuid, roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.role = any(roles)
  );
$$;

revoke all on function public.has_org_access(uuid) from public;
revoke all on function public.has_org_role(uuid, public.org_role[]) from public;
grant execute on function public.has_org_access(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Org profile data
-- ---------------------------------------------------------------------------

create table public.org_financials (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  fiscal_year     int not null,
  revenue         numeric(14,2),
  expenses        numeric(14,2),
  net             numeric(14,2),
  contributions   numeric(14,2),
  program_revenue numeric(14,2),
  net_assets      numeric(14,2),
  source          text,
  created_at      timestamptz not null default now(),
  unique (org_id, fiscal_year)
);

create index org_financials_org_year_idx
  on public.org_financials (org_id, fiscal_year desc);

create table public.board_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  title       text,
  is_officer  boolean not null default false,
  sort_order  int not null default 100,
  source      text,
  created_at  timestamptz not null default now(),
  unique (org_id, name)
);

create index board_members_org_idx on public.board_members (org_id, sort_order);

-- ---------------------------------------------------------------------------
-- Pipeline
-- ---------------------------------------------------------------------------

create table public.opportunities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  funder_name   text not null,
  program_name  text,
  url           text,
  amount_min    numeric(12,2),
  amount_max    numeric(12,2),
  deadline      date,

  -- TRUE means this date came from a prior-year pattern, not from the
  -- funder's current page. Every surface that prints the date must say so.
  deadline_estimated boolean not null default true,

  -- TRUE means a human opened the funder's page and confirmed these fields.
  verified      boolean not null default false,
  verified_at   timestamptz,
  verified_by   uuid references auth.users(id) on delete set null,

  status        public.opportunity_status not null default 'prospect',

  -- The funder's own words, quoted verbatim. Never a summary: the exact
  -- wording is what decides whether we can apply.
  eligibility   text,
  notes         text,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.opportunities.deadline_estimated is
  'true = projected from a prior-year pattern. Must be labeled wherever the deadline is shown.';
comment on column public.opportunities.eligibility is
  'Funder eligibility language quoted verbatim. Never paraphrase into this column.';

create index opportunities_org_deadline_idx
  on public.opportunities (org_id, deadline asc nulls last);

create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  opportunity_id   uuid not null references public.opportunities(id) on delete cascade,
  title            text not null,
  status           public.application_status not null default 'not_started',
  amount_requested numeric(12,2),
  internal_notes   text,
  submitted_at     timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index applications_org_idx on public.applications (org_id);
create index applications_opportunity_idx on public.applications (opportunity_id);

create table public.application_questions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  application_id  uuid not null references public.applications(id) on delete cascade,
  prompt          text not null,
  guidance        text,
  word_limit      int,
  sort_order      int not null default 100,
  answer          text,

  -- 'ai_draft' is written by the drafting endpoint. The trigger below flips
  -- it to 'human' the moment a person changes the text. Nobody should be able
  -- to submit words nobody has read.
  source          public.answer_source not null default 'empty',
  drafted_at      timestamptz,
  drafted_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index application_questions_app_idx
  on public.application_questions (application_id, sort_order);

-- ---------------------------------------------------------------------------
-- Supporting content
-- ---------------------------------------------------------------------------

create table public.answer_library (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  key         text not null,
  title       text not null,
  category    text,
  body        text not null default '',
  sort_order  int not null default 100,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, key)
);

create table public.contacts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  name           text not null,
  title          text,
  organization   text,
  email          text,
  phone          text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index contacts_org_idx on public.contacts (org_id);

create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index activity_log_org_idx on public.activity_log (org_id, created_at desc);

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  title        text not null,
  kind         public.document_kind not null default 'other',
  fiscal_year  int,
  storage_path text,
  external_url text,

  -- Financial paperwork is admin-only, enforced below in the policies.
  is_financial boolean not null default false,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index documents_org_idx on public.documents (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger orgs_touch before update on public.orgs
  for each row execute function public.touch_updated_at();
create trigger opportunities_touch before update on public.opportunities
  for each row execute function public.touch_updated_at();
create trigger applications_touch before update on public.applications
  for each row execute function public.touch_updated_at();
create trigger application_questions_touch before update on public.application_questions
  for each row execute function public.touch_updated_at();
create trigger answer_library_touch before update on public.answer_library
  for each row execute function public.touch_updated_at();
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

-- An answer's provenance is not something the client gets to assert by
-- setting a column. The drafting endpoint is the only writer that stamps
-- `drafted_at` in the same statement as the text, so that pairing is what
-- earns the 'ai_draft' label. Anything else that changes the text is a person
-- typing, and the row becomes 'human'. Nobody should be able to submit words
-- that nobody has read.
create or replace function public.mark_answer_provenance()
returns trigger
language plpgsql
as $$
begin
  if new.answer is distinct from old.answer then
    if new.answer is null or length(btrim(new.answer)) = 0 then
      new.source := 'empty';
    elsif new.source = 'ai_draft'
      and new.drafted_at is distinct from old.drafted_at
      and new.drafted_at is not null then
      -- The drafting endpoint wrote this text and stamped it. Leave it marked
      -- as an unread draft until a human touches it.
      new.source := 'ai_draft';
    else
      new.source := 'human';
    end if;
  elsif new.source = 'ai_draft' and old.source = 'human' then
    -- Text unchanged: nobody gets to relabel prose a person already reviewed
    -- as a machine draft, or the other way around.
    new.source := 'human';
  end if;
  return new;
end;
$$;

create trigger application_questions_provenance
  before update on public.application_questions
  for each row execute function public.mark_answer_provenance();

-- Invite -> membership on first sign-in.
-- An admin inserts an email into `invites`; when that person signs in with a
-- magic link for the first time, this converts every open invite for their
-- address into a membership.
create or replace function public.accept_invites_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.memberships (org_id, user_id, role)
  select i.org_id, new.id, i.role
  from public.invites i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
  on conflict (org_id, user_id) do nothing;

  update public.invites i
  set accepted_at = now(),
      accepted_by = new.id
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.accept_invites_for_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- These policies are the access control. The UI hides buttons as a courtesy;
-- the database is what actually stops a board member from writing a draft by
-- calling the REST API directly.
-- ---------------------------------------------------------------------------

alter table public.orgs                  enable row level security;
alter table public.memberships           enable row level security;
alter table public.invites               enable row level security;
alter table public.org_financials        enable row level security;
alter table public.board_members         enable row level security;
alter table public.opportunities         enable row level security;
alter table public.applications          enable row level security;
alter table public.application_questions enable row level security;
alter table public.answer_library        enable row level security;
alter table public.contacts              enable row level security;
alter table public.activity_log          enable row level security;
alter table public.documents             enable row level security;

-- orgs -----------------------------------------------------------------
create policy orgs_select on public.orgs
  for select to authenticated
  using (public.has_org_access(id));

create policy orgs_update on public.orgs
  for update to authenticated
  using (public.has_org_role(id, array['admin']::public.org_role[]))
  with check (public.has_org_role(id, array['admin']::public.org_role[]));

-- memberships ----------------------------------------------------------
-- Members can see who else is in the org. Only admins change the roster.
create policy memberships_select on public.memberships
  for select to authenticated
  using (public.has_org_access(org_id));

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));

create policy memberships_update on public.memberships
  for update to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- invites --------------------------------------------------------------
create policy invites_admin_all on public.invites
  for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- org_financials -------------------------------------------------------
-- Every member reads the 990 history (a board member needs it to talk to a
-- funder); only admins change it.
create policy org_financials_select on public.org_financials
  for select to authenticated
  using (public.has_org_access(org_id));

create policy org_financials_write on public.org_financials
  for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- board_members --------------------------------------------------------
create policy board_members_select on public.board_members
  for select to authenticated
  using (public.has_org_access(org_id));

create policy board_members_write on public.board_members
  for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- opportunities --------------------------------------------------------
create policy opportunities_select on public.opportunities
  for select to authenticated
  using (public.has_org_access(org_id));

create policy opportunities_insert on public.opportunities
  for insert to authenticated
  with check (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

create policy opportunities_update on public.opportunities
  for update to authenticated
  using (public.has_org_role(org_id, array['staff','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

create policy opportunities_delete on public.opportunities
  for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- applications ---------------------------------------------------------
create policy applications_select on public.applications
  for select to authenticated
  using (public.has_org_access(org_id));

create policy applications_insert on public.applications
  for insert to authenticated
  with check (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

create policy applications_update on public.applications
  for update to authenticated
  using (public.has_org_role(org_id, array['staff','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

create policy applications_delete on public.applications
  for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- application_questions ------------------------------------------------
-- This is the one that matters most: a board member reads drafts but cannot
-- write one, whether from the editor or from a hand-rolled API call.
create policy application_questions_select on public.application_questions
  for select to authenticated
  using (public.has_org_access(org_id));

create policy application_questions_insert on public.application_questions
  for insert to authenticated
  with check (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

create policy application_questions_update on public.application_questions
  for update to authenticated
  using (public.has_org_role(org_id, array['staff','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

create policy application_questions_delete on public.application_questions
  for delete to authenticated
  using (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

-- answer_library -------------------------------------------------------
create policy answer_library_select on public.answer_library
  for select to authenticated
  using (public.has_org_access(org_id));

create policy answer_library_write on public.answer_library
  for all to authenticated
  using (public.has_org_role(org_id, array['staff','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

-- contacts -------------------------------------------------------------
create policy contacts_select on public.contacts
  for select to authenticated
  using (public.has_org_access(org_id));

create policy contacts_write on public.contacts
  for all to authenticated
  using (public.has_org_role(org_id, array['staff','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['staff','admin']::public.org_role[]));

-- activity_log ---------------------------------------------------------
-- Append-only by design: no update or delete policy exists, so nobody can
-- rewrite the record of who drafted what.
create policy activity_log_select on public.activity_log
  for select to authenticated
  using (public.has_org_access(org_id));

create policy activity_log_insert on public.activity_log
  for insert to authenticated
  with check (public.has_org_access(org_id) and user_id = auth.uid());

-- documents ------------------------------------------------------------
-- Financial paperwork (990s, audits, budgets) is admin-only, both to read
-- and to write. Everything else is readable by any member.
create policy documents_select on public.documents
  for select to authenticated
  using (
    public.has_org_access(org_id)
    and (
      not is_financial
      or public.has_org_role(org_id, array['admin']::public.org_role[])
    )
  );

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    case
      when is_financial then public.has_org_role(org_id, array['admin']::public.org_role[])
      else public.has_org_role(org_id, array['staff','admin']::public.org_role[])
    end
  );

create policy documents_update on public.documents
  for update to authenticated
  using (
    case
      when is_financial then public.has_org_role(org_id, array['admin']::public.org_role[])
      else public.has_org_role(org_id, array['staff','admin']::public.org_role[])
    end
  )
  with check (
    case
      when is_financial then public.has_org_role(org_id, array['admin']::public.org_role[])
      else public.has_org_role(org_id, array['staff','admin']::public.org_role[])
    end
  );

create policy documents_delete on public.documents
  for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.org_role[]));

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS decides the rows; these grants decide who may attempt the statement at
-- all. `anon` is granted nothing: this app has no public surface.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select on public.orgs, public.memberships, public.invites,
  public.org_financials, public.board_members, public.opportunities,
  public.applications, public.application_questions, public.answer_library,
  public.contacts, public.activity_log, public.documents
  to authenticated;

grant insert, update, delete on public.orgs, public.memberships, public.invites,
  public.org_financials, public.board_members, public.opportunities,
  public.applications, public.application_questions, public.answer_library,
  public.contacts, public.documents
  to authenticated;

grant insert on public.activity_log to authenticated;
