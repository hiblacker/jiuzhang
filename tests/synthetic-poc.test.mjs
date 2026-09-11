import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { databaseName, sha256, verifyLocks, directory } from '../poc/synthetic-sql/run.mjs';

test('PoC generated database identifiers are bounded and cannot contain SQL', () => {
 assert.equal(databaseName('20260910010203_abcdef12'), 'p0_20260910010203_abcdef12');
 for (const bad of ['postgres', '../secrets', "20260910010203_abcdef12';DROP", '2026_1234']) {
  assert.throws(() => databaseName(bad), /Invalid experiment token/);
 }
});
test('PoC SQL artifacts match the immutable experiment checksums', async () => {
 assert.match(await verifyLocks(), /^[a-f0-9]{64}$/);
 assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('PoC compose is digest pinned, isolated and has no published port', async () => {
 const text = await readFile(path.join(directory, 'compose.yaml'), 'utf8');
 assert.match(text, /image: postgres@sha256:[a-f0-9]{64}/);
 assert.match(text, /pull_policy: never/);
 assert.match(text, /internal: true/);
 assert.match(text, /listen_addresses=/);
 assert.doesNotMatch(text, /^\s*ports:/m);
 assert.doesNotMatch(text, /POSTGRES_HOST_AUTH_METHOD/);
});
test('PoC shared lifecycle model has no source-specific mappings', async () => {
 const sql = await readFile(path.join(directory, 'models/lifecycle.sql'), 'utf8');
 assert.doesNotMatch(sql, /'devops'|'helpdesk'|'todo'|'resolved'|STORY|DEFECT/);
 assert.match(sql, /NULLIF\(f.samples,0\)/);
 assert.match(sql, /count\(DISTINCT e.object_id\)/);
});
test('PoC dependency manifest records all image packages including virtual exception', async () => {
 const manifest = JSON.parse(await readFile(path.join(directory, 'dependencies.lock.json'), 'utf8'));
 assert.equal(manifest.packages.length, 45);
 assert.deepEqual(manifest.additionalNpmDependencies, []);
 for (const pkg of manifest.packages) assert.ok(pkg.license || pkg.review, pkg.name);
});
test('PoC V003 gates flow integrity and separates roles without embedded secrets', async () => {
 const v3 = await readFile(path.join(directory, 'migrations/V003__flow_gate_roles.sql'), 'utf8');
 assert.match(v3, /flow integrity exception required/);
 assert.match(v3, /SECURITY DEFINER/);
 assert.match(v3, /immutable_flow_status/);
 assert.match(v3, /p0_worker/);
 assert.match(v3, /p0_publisher/);
 assert.match(v3, /security_barrier=true/);
 assert.doesNotMatch(v3, /PASSWORD\s+'/);
 const lock = JSON.parse(await readFile(path.join(directory, 'sql.lock.json'), 'utf8'));
 assert.match(lock['migrations/V003__flow_gate_roles.sql'], /^[a-f0-9]{64}$/);
});
test('PoC acceptance covers flow gate recovery, worker and publisher boundaries', async () => {
 const sql = await readFile(path.join(directory, 'tests/acceptance.sql'), 'utf8');
 assert.match(sql, /failed publish preserves ready state for retry/);
 assert.match(sql, /SET SESSION AUTHORIZATION p0_worker/);
 assert.match(sql, /SET SESSION AUTHORIZATION p0_publisher/);
 assert.match(sql, /worker cannot read raw or warehouse tables directly/);
 assert.match(sql, /publisher cannot alter release state directly/);
 const model = await readFile(path.join(directory, 'models/lifecycle.sql'), 'utf8');
 assert.match(model, /warehouse\.flow_status/);
 assert.match(model, /GRANT EXECUTE ON FUNCTION warehouse\.build/);
});
