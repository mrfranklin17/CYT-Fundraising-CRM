-- Row-level security tests.
--
-- These exist because "enforced by RLS, not UI checks" is a claim, and a claim
-- about access control is worth nothing unless something re-checks it. Each
-- test acts as a real signed-in user and asserts what that user can and cannot
-- do. A policy that stops enforcing fails the build.
--
-- Run against a scratch database that has had, in order:
--   00_harness.sql, migrations/0001_init.sql, seed.sql, 01_assertions.sql

\set ON_ERROR_STOP on

\set cyt      '''11111111-1111-4111-8111-111111111111'''
\set other    '''99999999-9999-4999-8999-999999999999'''
\set saga     '''22222222-2222-4222-8222-222222222201'''
\set app      '''33333333-3333-4333-8333-333333333301'''
\set question '''44444444-4444-4444-8444-444444444401'''
\set u_admin  '''aaaaaaaa-0000-4000-8000-000000000001'''
\set u_staff  '''aaaaaaaa-0000-4000-8000-000000000002'''
\set u_board  '''aaaaaaaa-0000-4000-8000-000000000003'''
\set u_none   '''aaaaaaaa-0000-4000-8000-000000000009'''
\set u_robot  '''aaaaaaaa-0000-4000-8000-00000000000a'''

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- A second organization, so tenant isolation is tested against real data
-- rather than against an empty table.
insert into public.orgs (id, slug, name)
values (:other, 'other-theater', 'Some Other Theater')
on conflict (id) do nothing;

insert into public.opportunities (id, org_id, funder_name, program_name, deadline)
values ('88888888-8888-4888-8888-888888888888', :other,
        'Other Funder', 'Secret Program', '2027-01-01')
on conflict (id) do nothing;

insert into public.applications (id, org_id, opportunity_id, title, status)
values (:app, :cyt, :saga, 'Spokane Arts - SAGA Round 3', 'drafting')
on conflict (id) do nothing;

insert into public.application_questions
  (id, org_id, application_id, prompt, sort_order)
values (:question, :cyt, :app, 'Describe your mission.', 10)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The invite flow
-- ---------------------------------------------------------------------------

\echo '== invite trigger =='

-- An admin invites three people at three roles. Note the deliberate case
-- mismatch on the first address.
insert into public.invites (org_id, email, role) values
  (:cyt, 'Admin@Example.org', 'admin'),
  (:cyt, 'staff@example.org', 'staff'),
  (:cyt, 'board@example.org', 'board')
on conflict (org_id, email) do nothing;

-- They sign in for the first time, and one uninvited stranger does too.
insert into auth.users (id, email) values
  (:u_admin, 'admin@example.org'),
  (:u_staff, 'staff@example.org'),
  (:u_board, 'board@example.org'),
  (:u_none,  'stranger@example.org')
on conflict (id) do nothing;

do $$
begin
  perform test_assert(
    (select role from public.memberships
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 'admin',
    'invite becomes a membership on first sign-in, matching email case-insensitively');

  perform test_assert(
    (select role from public.memberships
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000002') = 'staff',
    'the invited role is the role granted');

  perform test_assert(
    not exists (select 1 from public.memberships
                 where user_id = 'aaaaaaaa-0000-4000-8000-000000000009'),
    'a user who was never invited gets no membership');

  perform test_assert(
    (select count(*) from public.invites where accepted_at is not null) = 3,
    'accepted invites are marked accepted');
end;
$$;

-- ---------------------------------------------------------------------------
-- board: reads the pipeline, writes nothing
-- ---------------------------------------------------------------------------

\echo '== board role =='

do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000003');

  perform test_assert(
    (select count(*) from public.opportunities) = 3,
    'board reads its own org''s opportunities (and only those three)');

  perform test_assert(
    (select count(*) from public.org_financials) = 6,
    'board reads the 990 history');

  -- An UPDATE that matches no row under RLS affects nothing and raises
  -- nothing, so assert on the resulting state rather than on an error.
  update public.application_questions
     set answer = 'A board member wrote this.'
   where id = '44444444-4444-4444-8444-444444444401';

  perform test_assert(
    (select answer from public.application_questions
      where id = '44444444-4444-4444-8444-444444444401') is null,
    'board CANNOT write a draft, even by calling the API directly');

  perform test_assert(
    rejects($q$insert into public.opportunities (org_id, funder_name)
               values ('11111111-1111-4111-8111-111111111111', 'Sneaky Funder')$q$),
    'board CANNOT add an opportunity');

  perform test_assert(
    rejects($q$update public.answer_library set body = 'rewritten'$q$)
    or (select count(*) from public.answer_library where body = 'rewritten') = 0,
    'board CANNOT edit the answer library');
end;
$$;

-- ---------------------------------------------------------------------------
-- staff: writes drafts and adds opportunities, but not financials
-- ---------------------------------------------------------------------------

\echo '== staff role =='

do $$
declare
  new_id uuid;
  is_verified boolean;
  is_estimated boolean;
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000002');

  insert into public.opportunities (org_id, funder_name, program_name)
  values ('11111111-1111-4111-8111-111111111111', 'Test Funder', 'Test Program')
  returning id, verified, deadline_estimated
  into new_id, is_verified, is_estimated;

  perform test_assert(new_id is not null, 'staff CAN add an opportunity');
  perform test_assert(
    is_verified = false and is_estimated = true,
    'a new opportunity defaults to unverified with an estimated deadline');

  delete from public.opportunities where id = new_id;

  perform test_assert(
    rejects($q$update public.org_financials set revenue = 999999
                where fiscal_year = 2024$q$)
    or (select revenue from public.org_financials where fiscal_year = 2024) = 391024,
    'staff CANNOT alter the 990 figures');

  perform test_assert(
    rejects($q$insert into public.documents (org_id, title, kind, is_financial)
               values ('11111111-1111-4111-8111-111111111111',
                       'Sneaky budget', 'budget', true)$q$),
    'staff CANNOT upload a financial document');
end;
$$;

-- ---------------------------------------------------------------------------
-- Answer provenance
--
-- The property under test: nobody can submit words nobody has read.
-- ---------------------------------------------------------------------------

\echo '== answer provenance =='

do $$
declare
  current_source public.answer_source;
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000002');

  -- 1. The drafting endpoint writes text and stamps drafted_at together.
  update public.application_questions
     set answer = 'Model-written text.', source = 'ai_draft', drafted_at = now()
   where id = '44444444-4444-4444-8444-444444444401';

  select source into current_source from public.application_questions
   where id = '44444444-4444-4444-8444-444444444401';
  perform test_assert(current_source = 'ai_draft',
    'a stamped draft is marked ai_draft');

  -- 2. A person edits it.
  update public.application_questions
     set answer = 'Model-written text, with my correction.'
   where id = '44444444-4444-4444-8444-444444444401';

  select source into current_source from public.application_questions
   where id = '44444444-4444-4444-8444-444444444401';
  perform test_assert(current_source = 'human',
    'a human edit flips the row to human');

  -- 3. A client tries to relabel reviewed prose as a machine draft.
  update public.application_questions
     set source = 'ai_draft'
   where id = '44444444-4444-4444-8444-444444444401';

  select source into current_source from public.application_questions
   where id = '44444444-4444-4444-8444-444444444401';
  perform test_assert(current_source = 'human',
    'unchanged text cannot be relabeled as a draft');

  -- 4. Re-drafting an existing draft stays a draft.
  --    (This is the case the first version of the trigger got wrong: it
  --    mislabeled a re-draft as human-written, which would have marked unread
  --    machine text as reviewed.)
  update public.application_questions
     set answer = 'Draft one.', source = 'ai_draft', drafted_at = now()
   where id = '44444444-4444-4444-8444-444444444401';
  update public.application_questions
     set answer = 'Draft two.', source = 'ai_draft',
         drafted_at = now() + interval '1 second'
   where id = '44444444-4444-4444-8444-444444444401';

  select source into current_source from public.application_questions
   where id = '44444444-4444-4444-8444-444444444401';
  perform test_assert(current_source = 'ai_draft',
    're-drafting an existing AI draft stays ai_draft');

  -- 5. A client edits the text while claiming the model wrote it, with no
  --    fresh stamp. Provenance is the database's to decide, not the client's.
  update public.application_questions
     set answer = 'I typed this but claimed the model did.', source = 'ai_draft'
   where id = '44444444-4444-4444-8444-444444444401';

  select source into current_source from public.application_questions
   where id = '44444444-4444-4444-8444-444444444401';
  perform test_assert(current_source = 'human',
    'text edited without a fresh stamp becomes human, whatever the client claims');

  -- 6. Clearing the text returns the row to empty.
  update public.application_questions
     set answer = '   '
   where id = '44444444-4444-4444-8444-444444444401';

  select source into current_source from public.application_questions
   where id = '44444444-4444-4444-8444-444444444401';
  perform test_assert(current_source = 'empty',
    'blanking an answer returns it to empty');
end;
$$;

-- ---------------------------------------------------------------------------
-- admin: financial documents and the 990 record
-- ---------------------------------------------------------------------------

\echo '== admin role and document gating =='

-- `documents` has no natural unique key, so clear the fixture before inserting
-- it. Without this the counts below drift on a re-run against the same
-- database, and a test whose result depends on how many times it has been run
-- is not a test.
delete from public.documents
 where org_id = :cyt
   and title in ('FY2024 Form 990', 'Video work sample');

insert into public.documents (org_id, title, kind, is_financial) values
  (:cyt, 'FY2024 Form 990', 'form_990', true),
  (:cyt, 'Video work sample', 'work_sample', false);

do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000001');
  perform test_assert((select count(*) from public.documents) = 2,
    'admin sees financial and non-financial documents');
end;
$$;

do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000002');
  perform test_assert((select count(*) from public.documents) = 1,
    'staff sees only the non-financial document');
end;
$$;

do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000003');
  perform test_assert((select count(*) from public.documents) = 1,
    'board sees only the non-financial document');
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------

\echo '== tenant isolation =='

do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000001');

  perform test_assert(
    (select count(*) from public.orgs) = 1,
    'an admin sees only their own org, though two exist');

  perform test_assert(
    (select count(*) from public.opportunities
      where id = '88888888-8888-4888-8888-888888888888') = 0,
    'another org''s row is invisible even when its exact id is known');

  perform test_assert(
    rejects($q$insert into public.opportunities (org_id, funder_name)
               values ('99999999-9999-4999-8999-999999999999', 'Cross-tenant write')$q$),
    'an admin CANNOT write into another org');
end;
$$;

do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000009');

  perform test_assert((select count(*) from public.opportunities) = 0,
    'a signed-in user with no membership sees nothing');
  perform test_assert((select count(*) from public.orgs) = 0,
    'a signed-in user with no membership sees no org');
end;
$$;

-- ---------------------------------------------------------------------------
-- The activity log is append-only
-- ---------------------------------------------------------------------------

\echo '== activity log =='

do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000001');

  insert into public.activity_log (org_id, user_id, entity_type, action)
  values ('11111111-1111-4111-8111-111111111111',
          'aaaaaaaa-0000-4000-8000-000000000001', 'opportunity', 'verified');

  perform test_assert(
    rejects($q$update public.activity_log set action = 'nothing happened'$q$),
    'nobody can rewrite the activity log');

  perform test_assert(
    rejects($q$delete from public.activity_log$q$),
    'nobody can delete from the activity log');

  perform test_assert(
    (select action from public.activity_log limit 1) = 'verified',
    'the log entry survived both attempts');
end;
$$;

-- ---------------------------------------------------------------------------
-- The page watcher
--
-- A watch agent is a machine account with no membership. The point of these
-- tests is the negative space: the watcher can read the URL list and write
-- down what it fetched, and it can do nothing else. In particular it cannot
-- set `verified`, which is the bit the standing rule protects.
-- ---------------------------------------------------------------------------

\echo '== page watcher =='

-- The machine account, and an agent registration for CYT only.
insert into auth.users (id, email) values
  (:u_robot, 'watcher@example.org')
on conflict (id) do nothing;

insert into public.watch_agents (user_id, org_id, label) values
  (:u_robot, :cyt, 'Weekly funder page watcher')
on conflict (user_id, org_id) do nothing;

-- An admin appoints agents; nobody else does.
do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000002');
  perform test_assert(
    rejects($q$insert into public.watch_agents (user_id, org_id)
               values ('aaaaaaaa-0000-4000-8000-000000000009',
                       '11111111-1111-4111-8111-111111111111')$q$),
    'staff CANNOT appoint a watch agent');

  perform act_as('aaaaaaaa-0000-4000-8000-000000000003');
  perform test_assert(
    (select count(*) from public.watch_agents) = 1,
    'board can see which machine accounts act for its org');
end;
$$;

-- What the watcher can reach.
do $$
begin
  perform act_as('aaaaaaaa-0000-4000-8000-00000000000a');

  perform test_assert(
    (select count(*) from public.opportunities
      where org_id = '11111111-1111-4111-8111-111111111111') > 0,
    'the watcher CAN read its org''s opportunities');

  perform test_assert(
    (select count(*) from public.opportunities
      where org_id = '99999999-9999-4999-8999-999999999999') = 0,
    'the watcher CANNOT read another org''s opportunities');

  -- No membership means no access to anything a membership gates. These are
  -- the tables a scraped-page job has no business seeing.
  perform test_assert(
    (select count(*) from public.applications) = 0,
    'the watcher CANNOT read applications');
  perform test_assert(
    (select count(*) from public.application_questions) = 0,
    'the watcher CANNOT read drafts');
  perform test_assert(
    (select count(*) from public.org_financials) = 0,
    'the watcher CANNOT read the 990 history');
  perform test_assert(
    (select count(*) from public.answer_library) = 0,
    'the watcher CANNOT read the answer library');
  perform test_assert(
    (select count(*) from public.contacts) = 0,
    'the watcher CANNOT read contacts');
end;
$$;

-- The load-bearing restriction: the watcher cannot touch an opportunity.
do $$
declare
  before_verified boolean;
  after_verified  boolean;
  after_deadline  date;
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000002');
  update public.opportunities
     set verified = false, deadline = '2026-03-01', deadline_estimated = true
   where id = '22222222-2222-4222-8222-222222222201';

  perform act_as('aaaaaaaa-0000-4000-8000-00000000000a');

  select verified into before_verified from public.opportunities
   where id = '22222222-2222-4222-8222-222222222201';

  -- The tidying-up failure mode, attempted directly against the database.
  update public.opportunities
     set verified = true, verified_at = now(), deadline_estimated = false
   where id = '22222222-2222-4222-8222-222222222201';

  update public.opportunities
     set deadline = '2026-09-30'
   where id = '22222222-2222-4222-8222-222222222201';

  select verified, deadline into after_verified, after_deadline
    from public.opportunities
   where id = '22222222-2222-4222-8222-222222222201';

  perform test_assert(before_verified is false and after_verified is false,
    'the watcher CANNOT set verified, which is the whole point of it');
  perform test_assert(after_deadline = '2026-03-01',
    'the watcher CANNOT move a deadline');

  perform test_assert(
    rejects($q$insert into public.opportunities (org_id, funder_name)
               values ('11111111-1111-4111-8111-111111111111', 'Robot Funder')$q$),
    'the watcher CANNOT add an opportunity');
end;
$$;

-- What the watcher is for: recording that a page moved.
do $$
declare
  changed_at timestamptz;
begin
  perform act_as('aaaaaaaa-0000-4000-8000-00000000000a');

  insert into public.opportunity_watch
    (opportunity_id, org_id, url, content_hash, content_length,
     last_checked_at, last_changed_at, last_status)
  values ('22222222-2222-4222-8222-222222222201',
          '11111111-1111-4111-8111-111111111111',
          'https://example.org/grant', 'hash-one', 1200, now(), now(), 200);

  perform test_assert(
    (select count(*) from public.opportunity_watch) = 1,
    'the watcher CAN record an observation');

  update public.opportunity_watch
     set content_hash = 'hash-two', last_changed_at = now(), last_checked_at = now()
   where opportunity_id = '22222222-2222-4222-8222-222222222201';

  perform test_assert(
    (select content_hash from public.opportunity_watch
      where opportunity_id = '22222222-2222-4222-8222-222222222201') = 'hash-two',
    'the watcher CAN update its own observation');

  -- A watcher that could clear its own flag would look identical to one that
  -- never raised it.
  perform test_assert(
    rejects($q$update public.opportunity_watch set acknowledged_at = now()
                where opportunity_id = '22222222-2222-4222-8222-222222222201'$q$),
    'the watcher CANNOT acknowledge its own finding');

  perform test_assert(
    rejects($q$insert into public.opportunity_watch
                 (opportunity_id, org_id, url)
               values ('88888888-8888-4888-8888-888888888888',
                       '99999999-9999-4999-8999-999999999999',
                       'https://example.org/other')$q$),
    'the watcher CANNOT write an observation for another org');
end;
$$;

-- The human half.
do $$
declare
  ack timestamptz;
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000003');

  perform test_assert(
    (select count(*) from public.opportunity_watch) = 1,
    'board CAN see that a funder''s page changed');

  update public.opportunity_watch
     set acknowledged_at = now(), acknowledged_by = auth.uid()
   where opportunity_id = '22222222-2222-4222-8222-222222222201';

  perform test_assert(
    (select acknowledged_at from public.opportunity_watch
      where opportunity_id = '22222222-2222-4222-8222-222222222201') is null,
    'board CANNOT acknowledge a change (board reads the pipeline)');

  perform act_as('aaaaaaaa-0000-4000-8000-000000000002');

  update public.opportunity_watch
     set acknowledged_at = now(), acknowledged_by = auth.uid()
   where opportunity_id = '22222222-2222-4222-8222-222222222201';

  select acknowledged_at into ack from public.opportunity_watch
   where opportunity_id = '22222222-2222-4222-8222-222222222201';

  perform test_assert(ack is not null,
    'staff CAN acknowledge, having re-read the page');

  -- A person re-reads the page; they do not get to rewrite the fetch record.
  perform test_assert(
    rejects($q$update public.opportunity_watch set content_hash = 'forged'
                where opportunity_id = '22222222-2222-4222-8222-222222222201'$q$),
    'staff CANNOT rewrite what the watcher observed');

  perform test_assert(
    rejects($q$insert into public.opportunity_watch (opportunity_id, org_id, url)
               values ('22222222-2222-4222-8222-222222222202',
                       '11111111-1111-4111-8111-111111111111',
                       'https://example.org/invented')$q$),
    'staff CANNOT invent an observation nobody fetched');
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
--
-- These assertions only mean something because 00_harness.sql replicates
-- Supabase's default privileges. Remove that line and these pass trivially
-- while production stays exposed.
-- ---------------------------------------------------------------------------

\echo '== function privileges =='

do $$
begin
  -- The SECURITY DEFINER helpers run with the definer's rights, so an
  -- unauthenticated caller must not be able to invoke them over the REST API.
  perform test_assert(
    not has_function_privilege('anon', 'public.has_org_access(uuid)', 'execute'),
    'anon CANNOT execute has_org_access');
  perform test_assert(
    not has_function_privilege('anon', 'public.has_org_role(uuid, public.org_role[])', 'execute'),
    'anon CANNOT execute has_org_role');

  -- ...but signed-in users must keep it, because every RLS policy calls these
  -- and a policy is evaluated as the calling role. Revoking would deny the app.
  perform test_assert(
    has_function_privilege('authenticated', 'public.has_org_access(uuid)', 'execute'),
    'authenticated CAN execute has_org_access (every policy depends on it)');
  perform test_assert(
    has_function_privilege('authenticated', 'public.has_org_role(uuid, public.org_role[])', 'execute'),
    'authenticated CAN execute has_org_role (every policy depends on it)');

  -- Trigger functions are fired by the system; no client role needs EXECUTE.
  perform test_assert(
    not has_function_privilege('anon', 'public.accept_invites_for_new_user()', 'execute')
    and not has_function_privilege('authenticated', 'public.accept_invites_for_new_user()', 'execute'),
    'no client role can execute the invite trigger function directly');
  perform test_assert(
    not has_function_privilege('anon', 'public.touch_updated_at()', 'execute')
    and not has_function_privilege('authenticated', 'public.touch_updated_at()', 'execute'),
    'no client role can execute touch_updated_at directly');
  perform test_assert(
    not has_function_privilege('anon', 'public.mark_answer_provenance()', 'execute')
    and not has_function_privilege('authenticated', 'public.mark_answer_provenance()', 'execute'),
    'no client role can execute mark_answer_provenance directly');

  -- is_watch_agent decides whether a caller may write watch observations, so a
  -- SECURITY DEFINER copy of it reachable without a session would let anyone
  -- probe agent registration over PostgREST.
  perform test_assert(
    not has_function_privilege('anon', 'public.is_watch_agent(uuid)', 'execute'),
    'anon CANNOT execute is_watch_agent');
  perform test_assert(
    has_function_privilege('authenticated', 'public.is_watch_agent(uuid)', 'execute'),
    'authenticated CAN execute is_watch_agent (the watch policies depend on it)');
  perform test_assert(
    not has_function_privilege('anon', 'public.enforce_watch_write_scope()', 'execute')
    and not has_function_privilege('authenticated', 'public.enforce_watch_write_scope()', 'execute'),
    'no client role can execute enforce_watch_write_scope directly');

  -- search_path pinned on every function we define.
  perform test_assert(
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('has_org_access','has_org_role','accept_invites_for_new_user',
                          'touch_updated_at','mark_answer_provenance',
                          'is_watch_agent','enforce_watch_write_scope')
        and p.proconfig is null
    ),
    'every Grantboard function pins its search_path');
end;
$$;

-- ---------------------------------------------------------------------------
-- Table privileges
--
-- Same reasoning, one layer down, and the same dependency on the harness:
-- these assertions are only meaningful because 00_harness.sql replicates
-- Supabase's default privileges for TABLES. Drop that line and every one of
-- them passes without testing anything, because the harness would then show
-- the grants 0001 wrote rather than the grants the project has.
-- ---------------------------------------------------------------------------

\echo '== table privileges =='

do $$
begin
  perform test_assert(
    not exists (
      select 1 from information_schema.table_privileges
      where grantee = 'anon' and table_schema = 'public'
    ),
    'anon holds no privilege on any table (this app has no public surface)');

  -- TRUNCATE is not subject to row-level security, so a grant of it is not
  -- something a policy can contain.
  perform test_assert(
    not exists (
      select 1 from information_schema.table_privileges
      where grantee = 'authenticated' and table_schema = 'public'
        and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    ),
    'authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any table');

  -- The append-only guarantee, asserted at the grant layer rather than only
  -- through the absence of a policy.
  perform test_assert(
    not exists (
      select 1 from information_schema.table_privileges
      where grantee = 'authenticated' and table_name = 'activity_log'
        and privilege_type in ('UPDATE', 'DELETE')
    ),
    'authenticated cannot even attempt an UPDATE or DELETE on the activity log');

  perform test_assert(
    has_table_privilege('authenticated', 'public.activity_log', 'insert')
    and has_table_privilege('authenticated', 'public.opportunity_watch', 'select'),
    'the grants the app actually needs survived the revoke');
end;
$$;

-- Revoking EXECUTE must not stop the triggers firing. This is the check that
-- makes the revocations above safe rather than merely quiet.
do $$
declare
  current_source public.answer_source;
begin
  perform act_as('aaaaaaaa-0000-4000-8000-000000000002');

  update public.application_questions
     set answer = 'Stamped by the endpoint.', source = 'ai_draft', drafted_at = now()
   where id = '44444444-4444-4444-8444-444444444401';
  update public.application_questions
     set answer = 'Then edited by a person.'
   where id = '44444444-4444-4444-8444-444444444401';

  select source into current_source from public.application_questions
   where id = '44444444-4444-4444-8444-444444444401';

  perform test_assert(current_source = 'human',
    'the provenance trigger still fires after EXECUTE is revoked');
end;
$$;

\echo ''
\echo 'All row-level security tests passed.'
