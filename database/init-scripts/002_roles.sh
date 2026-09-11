#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE nexus LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE nexus TO nexus;
GRANT USAGE ON SCHEMA public TO nexus;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexus;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexus;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM nexus;
REVOKE ALL ON schema_migrations FROM nexus;
GRANT SELECT ON schema_migrations TO nexus;
SQL
