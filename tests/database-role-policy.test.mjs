import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('V008 separates control and ingestion privileges without broad grants', async () => {
  const migration = await read('migrations/V008__database_role_boundaries.sql');
  assert.match(migration, /CREATE ROLE bydw_control_api NOLOGIN NOSUPERUSER/);
  assert.match(migration, /CREATE ROLE bydw_ingestion_worker NOLOGIN NOSUPERUSER/);
  assert.match(migration, /CREATE ROLE bydw_control_api_login NOLOGIN/);
  assert.match(migration, /CREATE ROLE bydw_ingestion_worker_login NOLOGIN/);
  assert.match(migration, /GRANT SELECT ON raw\.ingestion_batch_manifest TO bydw_control_api/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION raw\.ingest_record/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION raw\.seal_ingestion_batch/);
  assert.match(migration, /REVOKE ALL ON TABLE raw\.ingestion_record/);
  assert.match(migration, /REVOKE ALL ON FUNCTION raw\.ingest_record/);
  assert.match(migration, /REVOKE CONNECT ON DATABASE %I FROM PUBLIC/);
  assert.match(
    migration,
    /GRANT CONNECT ON DATABASE %I TO bydw_control_api, bydw_ingestion_worker, /,
  );
  assert.doesNotMatch(migration, /GRANT\s+ALL/i);
  assert.doesNotMatch(migration, /PASSWORD/i);
  assert.doesNotMatch(migration, /GRANT[^;]*raw\.ingestion_record[^;]*bydw_control_api/is);
  assert.doesNotMatch(migration, /GRANT[^;]*(DELETE|TRUNCATE)[^;]*bydw_/is);
  assert.doesNotMatch(
    migration,
    /GRANT[^;]*control\.(?:source_connection|ingestion_job|ingestion_batch)[^;]*bydw_ingestion_worker/is,
  );
});

test('role provisioning reads secrets from environment and never command arguments', async () => {
  const script = await read('deploy/scripts/provision-roles.sh');
  assert.match(script, /\\getenv control_api_password CONTROL_API_DB_PASSWORD/);
  assert.match(script, /\\getenv worker_password INGESTION_WORKER_DB_PASSWORD/);
  assert.match(script, /\$\{#CONTROL_API_DB_PASSWORD\} < 24/);
  assert.match(script, /CONTROL_API_DB_PASSWORD\}" == "\$\{INGESTION_WORKER_DB_PASSWORD\}/);
  assert.doesNotMatch(script, /-v\s+['"]?(?:control_api_password|worker_password)=/);
  assert.doesNotMatch(script, /echo[^\n]*(?:CONTROL_API_DB_PASSWORD|INGESTION_WORKER_DB_PASSWORD)/);
});

test('Compose runs migrations and role provisioning before the restricted API login', async () => {
  const compose = await read('deploy/compose.yaml');
  const config = await read('apps/control-api/src/main/resources/application.yml');
  const envExample = await read('deploy/.env.example');
  assert.match(compose, /provision-roles:/);
  assert.match(compose, /image: bydw\/control-api:0\.1\.0-dev\.6/);
  assert.match(compose, /CONTROL_API_DB_USERNAME: bydw_control_api_login/);
  assert.match(compose, /CONTROL_API_DB_PASSWORD: \$\{CONTROL_API_DB_PASSWORD:\?set CONTROL_API_DB_PASSWORD\}/);
  assert.match(compose, /INGESTION_WORKER_DB_PASSWORD: \$\{INGESTION_WORKER_DB_PASSWORD:\?set INGESTION_WORKER_DB_PASSWORD\}/);
  assert.match(compose, /provision-roles:\s*\n\s*condition: service_completed_successfully/);
  assert.match(config, /username: \$\{CONTROL_API_DB_USERNAME:bydw_control_api_login\}/);
  assert.match(config, /password: \$\{CONTROL_API_DB_PASSWORD\}/);
  assert.match(envExample, /^CONTROL_API_DB_PASSWORD=/m);
  assert.match(envExample, /^INGESTION_WORKER_DB_PASSWORD=/m);
  assert.doesNotMatch(compose, /control-api:[\s\S]*WAREHOUSE_DB_PASSWORD:/);
  assert.doesNotMatch(config, /WAREHOUSE_DB_USERNAME/);
});
