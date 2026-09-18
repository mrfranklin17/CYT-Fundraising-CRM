-- Tighten function privileges.
--
-- WHY THIS EXISTS
--
-- Supabase applies default privileges that grant EXECUTE on every new function
-- in `public` to the `anon` and `authenticated` roles. The initial migration's
-- `revoke all on function ... from public` does not undo that: revoking from
-- PUBLIC leaves an explicit per-role grant untouched. So the SECURITY DEFINER
-- helpers shipped callable by `anon` over the REST API.
--
-- It was not exploitable as written -- `auth.uid()` is null for an unauthenticated
-- caller, so `has_org_access` simply returns false, and Postgres refuses to invoke
-- a trigger function as a regular function -- but the grant should never have
-- been there, and "not exploitable today" is not a property to rely on.
--
-- This was found by Supabase's own database linter against a real project, not
-- by the test suite, because the suite's harness did not replicate Supabase's
-- default privileges. The harness now does (supabase/tests/00_harness.sql), and
-- the assertions in 02_rls_test.sql fail without this migration.

-- `authenticated` MUST keep EXECUTE on these two. Every RLS policy calls them,
-- and a policy expression is evaluated as the calling role -- revoke this and
-- every query in the application is denied.
revoke all on function public.has_org_access(uuid) from anon;
revoke all on function public.has_org_role(uuid, public.org_role[]) from anon;

grant execute on function public.has_org_access(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- Trigger functions are invoked by the system when a statement fires them, not
-- called by clients. Postgres does not check EXECUTE on a trigger function at
-- fire time, so no application role needs the privilege.
revoke all on function public.accept_invites_for_new_user() from anon, authenticated, public;
revoke all on function public.touch_updated_at() from anon, authenticated, public;
revoke all on function public.mark_answer_provenance() from anon, authenticated, public;

-- Pin search_path on the two trigger functions that were missing it, so the
-- functions they call (btrim, length, now) cannot be redirected at a shadowed
-- object. The SECURITY DEFINER functions already pin theirs.
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.mark_answer_provenance() set search_path = public, pg_temp;
