#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
if [[ -e .env ]]; then printf ".env already exists; preserved.\n"; exit 0; fi
{
  printf "METADATA_PASSWORD=%s\n" "$(openssl rand -hex 24)"
  printf "SOURCE_ROOT_PASSWORD=%s\n" "$(openssl rand -hex 24)"
  printf "JIUZHANG_MASTER_KEY=%s\n" "$(openssl rand -base64 32)"
  printf "JIUZHANG_BOOTSTRAP_USER=admin\n"
  printf "JIUZHANG_BOOTSTRAP_PASSWORD=%s\n" "$(openssl rand -hex 16)"
} > .env
printf "Created private .env. Credentials are never printed to logs.\n"
