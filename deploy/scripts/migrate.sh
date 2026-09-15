#!/usr/bin/env bash
set -euo pipefail

psql --no-psqlrc -v ON_ERROR_STOP=1 --single-transaction <<'SQL'
SELECT pg_advisory_xact_lock(74123, 1);
CREATE SCHEMA IF NOT EXISTS control;
CREATE TABLE IF NOT EXISTS control.schema_migration (
  version VARCHAR(255) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

for migration in /migrations/V*.sql; do
  filename="$(basename "${migration}")"
  if [[ ! "${filename}" =~ ^V[0-9]{3}__[A-Za-z0-9_]+\.sql$ ]]; then
    echo "Invalid migration filename: ${filename}" >&2
    exit 1
  fi
  checksum="$(sha256sum "${migration}" | cut -d ' ' -f 1)"
  # The DDL and its checksum are one transaction; a crash cannot leave an
  # applied migration without a ledger entry. The lock also serializes runners.
  psql --no-psqlrc -v ON_ERROR_STOP=1 --single-transaction \
    -v "version=${filename}" -v "checksum=${checksum}" -v "migration=${migration}" <<'SQL'
SELECT pg_advisory_xact_lock(74123, 1);
SELECT EXISTS(SELECT 1 FROM control.schema_migration WHERE version = :'version') AS applied,
       NOT EXISTS(SELECT 1 FROM control.schema_migration WHERE version = :'version' AND checksum <> :'checksum') AS checksum_matches
\gset
\if :checksum_matches
\else
  DO $$ BEGIN RAISE EXCEPTION 'MIGRATION_CHECKSUM_MISMATCH'; END $$;
\endif
\if :applied
\else
  \i :migration
  INSERT INTO control.schema_migration(version, checksum) VALUES (:'version', :'checksum');
\endif
SQL
done
