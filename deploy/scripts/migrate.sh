#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 <<'SQL'
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
  recorded="$(printf "SELECT checksum FROM control.schema_migration WHERE version = :'version';\n" | psql -At -v ON_ERROR_STOP=1 -v "version=${filename}")"
  if [[ -n "${recorded}" ]]; then
    [[ "${recorded}" == "${checksum}" ]] || { echo "Migration checksum mismatch: ${filename}" >&2; exit 1; }
    continue
  fi
  psql -v ON_ERROR_STOP=1 -1 -f "${migration}"
  printf "INSERT INTO control.schema_migration(version, checksum) VALUES (:'version', :'checksum');\n" | \
    psql -v ON_ERROR_STOP=1 -v "version=${filename}" -v "checksum=${checksum}"
done
