-- Assertion helpers for the policy tests.
--
-- Every check raises an exception on failure. Run with `psql -v ON_ERROR_STOP=1`
-- so that a single failed assertion fails the build.

create or replace function test_assert(condition boolean, description text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'FAIL: %', description;
  end if;
  raise notice '  ok  %', description;
end;
$$;

-- Act as a given signed-in user for the remainder of the current transaction.
create or replace function act_as(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Run a statement that RLS must reject, and report whether it was rejected.
-- A statement that unexpectedly succeeds returns false, which fails the caller's
-- assertion — so a policy that stops enforcing is caught, not silently passed.
create or replace function rejects(statement text)
returns boolean
language plpgsql
as $$
begin
  execute statement;
  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;
