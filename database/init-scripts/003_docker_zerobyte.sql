CREATE TABLE IF NOT EXISTS docker_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  endpoint text NOT NULL,
  credentials_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_sync timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zerobyte_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  endpoint text NOT NULL,
  credentials_encrypted text NOT NULL,
  docker_host_id uuid NOT NULL REFERENCES docker_hosts ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  last_sync timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON docker_hosts,zerobyte_instances TO nexus;
INSERT INTO schema_migrations(version) VALUES('003_docker_zerobyte.sql') ON CONFLICT DO NOTHING;
