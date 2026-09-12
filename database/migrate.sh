#!/bin/sh
set -eu
# The database owner is used only by this short-lived service.
psql -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(401010);
\i /docker-entrypoint-initdb.d/003_docker_zerobyte.sql
COMMIT;
SQL
