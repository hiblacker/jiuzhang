#!/usr/bin/env bash
set -euo pipefail

: "${CONTROL_API_DB_PASSWORD:?set CONTROL_API_DB_PASSWORD}"
: "${INGESTION_WORKER_DB_PASSWORD:?set INGESTION_WORKER_DB_PASSWORD}"

if (( ${#CONTROL_API_DB_PASSWORD} < 24 || ${#INGESTION_WORKER_DB_PASSWORD} < 24 )); then
  echo "Database role passwords must each contain at least 24 characters" >&2
  exit 1
fi
if [[ "${CONTROL_API_DB_PASSWORD}" == "${INGESTION_WORKER_DB_PASSWORD}" ]]; then
  echo "Control API and Worker database passwords must be different" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 <<'SQL'
\getenv control_api_password CONTROL_API_DB_PASSWORD
\getenv worker_password INGESTION_WORKER_DB_PASSWORD
ALTER ROLE bydw_control_api_login LOGIN PASSWORD :'control_api_password';
ALTER ROLE bydw_ingestion_worker_login LOGIN PASSWORD :'worker_password';
SQL

echo "Provisioned restricted login roles for control API and ingestion worker"

# The product runtime uses an independently provisioned SQL worker login.
if [[ -n "${MODEL_WORKER_DB_PASSWORD:-}" ]]; then
  if (( ${#MODEL_WORKER_DB_PASSWORD} < 24 )) || [[ "${MODEL_WORKER_DB_PASSWORD}" == "${CONTROL_API_DB_PASSWORD}" || "${MODEL_WORKER_DB_PASSWORD}" == "${INGESTION_WORKER_DB_PASSWORD}" ]]; then
    echo "Model worker requires a distinct password of at least 24 characters" >&2
    exit 1
  fi
  psql --no-psqlrc -v ON_ERROR_STOP=1 <<'SQL'
\getenv model_password MODEL_WORKER_DB_PASSWORD
ALTER ROLE bydw_model_worker_login LOGIN PASSWORD :'model_password';
SQL
fi
