import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, validateContract } from '../tools/lake-model.mjs';

test('model contract bounds source paths and key definitions', () => {
  assert.throws(() => validateContract({ version: 1, dataset_code: 'x', input: { path: '../escape' }, key: ['id'] }), /MODEL_INPUT_PATH_INVALID/);
  assert.throws(() => validateContract({ version: 1, dataset_code: 'x', input: { path: 'raw.jsonl' }, key: [] }), /MODEL_KEY_INVALID/);
});

test('quality failure keeps the previously published candidate active', async () => {
  const actual = await mkdtemp(path.join(os.tmpdir(), 'jiuzhang-model-'));
  try {
    await mkdir(path.join(actual, 'raw', 'batch', 'orders'), { recursive: true });
    await writeFile(path.join(actual, 'raw', 'batch', 'orders', 'schema.json'), JSON.stringify({ columns: [{ column: 'id' }, { column: 'name' }] }));
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
