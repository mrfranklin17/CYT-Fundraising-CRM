-- A minimal stand-in for the parts of a Supabase project that the migration
-- depends on: the `authenticated` role, the `auth` schema, `auth.users`, and
-- `auth.uid()`.
--
-- This exists so the RLS policies can be exercised against a real Postgres in
-- CI. It is NOT applied to the Supabase project — Supabase provides all of
-- this already. Nothing here should ever be copied into a migration.

create extension if not exists pgcrypto;

-- Roles are cluster-wide, not per-database, so create them only if absent.
-- This keeps the harness re-runnable against a cluster that already has them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

grant anon, authenticated, service_role to current_user;

-- Supabase applies default privileges granting EXECUTE on every new function in
-- `public` to anon and authenticated. Replicate that here.
--
-- Without this line the harness is MORE RESTRICTIVE than production, which hides
-- real bugs rather than catching them: migration 0002 exists because a grant that
-- only appears under these default privileges went unnoticed locally and was
-- caught by Supabase's linter against a live project instead.
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- The same applies to TABLES, and this one is easier to miss because RLS hides
-- its effect: every table created in `public` is granted to anon and
-- authenticated automatically. RLS still decides the rows, so a policy written
-- `to authenticated` keeps anon out regardless — but the grant is real, and
-- 0001's "anon is granted nothing" was only true of the harness until this line
-- existed. Replicating it is what lets the assertions below actually bite.
alter default privileges in schema public grant all on tables to anon, authenticated;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase derives the current user from the request's JWT claims. Tests set
-- `request.jwt.claim.sub` to act as a given user.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to authenticated, anon;
