#!/usr/bin/env bash
#
# Apply the schema to a scratch database and run the policy tests against it.
#
# CI calls this against a throwaway Postgres service container. It also runs
# locally against any Postgres you can reach — point the standard PG* variables
# at it and run `npm run test:db`.
#
# The runner creates and drops its own scratch database on every run. A
# migration is meant to run exactly once, so re-running the suite means a fresh
# database rather than an idempotent migration. Set GRANTBOARD_TEST_DB to
# change the scratch database's name; set GRANTBOARD_KEEP_DB=1 to leave it in
# place afterwards for poking at a failure.
#
# Every step runs with ON_ERROR_STOP, so the first failed assertion fails the
# run.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

SCRATCH_DB="${GRANTBOARD_TEST_DB:-grantboard_rls_test}"
# The database used only to issue CREATE/DROP DATABASE against.
ADMIN_DB="${GRANTBOARD_ADMIN_DB:-postgres}"

admin_sql() {
  psql --no-psqlrc --quiet -v ON_ERROR_STOP=1 -d "$ADMIN_DB" -c "$1"
}

scratch_file() {
  psql --no-psqlrc --quiet -v ON_ERROR_STOP=1 -d "$SCRATCH_DB" -f "$1"
}

cleanup() {
  if [ "${GRANTBOARD_KEEP_DB:-0}" = "1" ]; then
    echo "Leaving scratch database '$SCRATCH_DB' in place (GRANTBOARD_KEEP_DB=1)."
    return
  fi
  admin_sql "drop database if exists \"$SCRATCH_DB\" with (force);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Fresh scratch database: $SCRATCH_DB"
admin_sql "drop database if exists \"$SCRATCH_DB\" with (force);" >/dev/null
admin_sql "create database \"$SCRATCH_DB\";" >/dev/null

echo "==> Supabase-shaped test harness"
scratch_file "$HERE/00_harness.sql"

echo "==> Migration"
scratch_file "$ROOT/supabase/migrations/0001_init.sql"

echo "==> Seed"
scratch_file "$ROOT/supabase/seed.sql"

echo "==> Seed again (must be idempotent)"
scratch_file "$ROOT/supabase/seed.sql"

echo "==> Assertion helpers"
scratch_file "$HERE/01_assertions.sql"

echo "==> Row-level security tests"
scratch_file "$HERE/02_rls_test.sql"

echo
echo "Schema, seed and policy tests all passed."
