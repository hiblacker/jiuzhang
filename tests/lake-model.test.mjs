import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, publishCandidate, validateContract } from '../tools/lake-model.mjs';

test('model contract bounds source paths and key definitions', () => {
  assert.throws(() => validateContract({ version: 1, dataset_code: 'x', input: { path: '../escape' }, key: ['id'] }), /MODEL_INPUT_PATH_INVALID/);
  assert.throws(() => validateContract({ version: 1, dataset_code: 'x', input: { path: 'raw.jsonl' }, key: [] }), /MODEL_KEY_INVALID/);
});

test('late completion cannot replace an active release that changed during the build', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-publish-cas-'));
  try {
    await writeFile(path.join(root, 'input.jsonl'), '{"id":9007199254740993}\n');
    const contract = path.join(root, 'contract.json');
    await writeFile(contract, JSON.stringify({ version: 1, dataset_code: 'ids', input: { path: 'input.jsonl' }, key: ['id'] }));
    const first = await run({ contract, lakeRoot: root });
    const activeBefore = await readFile(path.join(root, 'datasets/ids/active.json'), 'utf8');
    assert.match(await readFile(path.join(root, first.candidate.path), 'utf8'), /"9007199254740993"/);
    const late = { ...first, candidateId: 'late-build', state: 'READY' };
    await mkdir(path.join(root, 'datasets/ids/late-build'));
    await writeFile(path.join(root, 'datasets/ids/late-build/manifest.json'), JSON.stringify(late));
    const refused = await publishCandidate({ lakeRoot: root }, late, null);
    assert.equal(refused.state, 'STALE');
    assert.equal(await readFile(path.join(root, 'datasets/ids/active.json'), 'utf8'), activeBefore);
    await writeFile(path.join(root, 'input.jsonl'), '{"id":null}\n');
    assert.equal((await run({ contract, lakeRoot: root })).state, 'REJECTED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy MySQL JSON quoting is decoded without modifying sealed source bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-mysql-v1-'));
  try {
    const bytes = JSON.stringify(['"9007199254740993"', '"中文"']) + '\n';
    await writeFile(path.join(root, 'raw.jsonl'), bytes);
    await writeFile(path.join(root, 'schema.json'), JSON.stringify({ columns: [{ column: 'id' }, { column: 'name' }] }));
    const contract = path.join(root, 'contract.json');
    await writeFile(contract, JSON.stringify({ version: 1, dataset_code: 'legacy', input: { path: 'raw.jsonl', schema_path: 'schema.json', format: 'mysql-jsonl' }, key: ['id'] }));
    const result = await run({ contract, lakeRoot: root });
    assert.deepEqual(JSON.parse(await readFile(path.join(root, result.candidate.path))), { id: '9007199254740993', name: '中文' });
    assert.equal(await readFile(path.join(root, 'raw.jsonl'), 'utf8'), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('quality failure keeps the previously published candidate active', async () => {
  const actual = await mkdtemp(path.join(os.tmpdir(), 'jiuzhang-model-'));
  try {
    await mkdir(path.join(actual, 'raw', 'batch', 'orders'), { recursive: true });
    await writeFile(path.join(actual, 'raw', 'batch', 'orders', 'schema.json'), JSON.stringify({ scalarEncoding: 'mysql-char-v2', columns: [{ column: 'id' }, { column: 'name' }] }));
    await writeFile(path.join(actual, 'raw', 'batch', 'orders', 'data.jsonl'), '["1","A"]\n["2","B"]\n');
    const contractFile = path.join(actual, 'contract.json');
    const contract = { version: 1, dataset_code: 'orders', input: { path: 'raw/batch/orders/data.jsonl', schema_path: 'raw/batch/orders/schema.json', format: 'mysql-jsonl' }, key: ['id'], required: ['id'], output: { fields: ['id', 'name'] }, quality: { max_duplicate_keys: 0 } };
    await writeFile(contractFile, JSON.stringify(contract));
    const first = await run({ contract: contractFile, lakeRoot: actual, dryRun: false });
    assert.equal(first.state, 'PUBLISHED');
    const activeBefore = JSON.parse(await readFile(path.join(actual, 'datasets', 'orders', 'active.json')));
    assert.match(activeBefore.manifestSha256, /^[0-9a-f]{64}$/);
    await writeFile(path.join(actual, 'raw', 'batch', 'orders', 'data.jsonl'), '["1","A"]\n["1","duplicate"]\n');
    const second = await run({ contract: contractFile, lakeRoot: actual, dryRun: false });
    assert.equal(second.state, 'REJECTED');
    const activeAfter = JSON.parse(await readFile(path.join(actual, 'datasets', 'orders', 'active.json')));
    assert.equal(activeAfter.candidateId, activeBefore.candidateId);
    assert.equal(second.quality.duplicateCount, 1);
  } finally {
    await rm(actual, { recursive: true, force: true });
  }
});
