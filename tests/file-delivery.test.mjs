import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { run } from '../tools/file-delivery.mjs';
import { digest } from '../tools/lake-runtime.mjs';

async function fixture(t, contract) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { inbox: path.join(root, 'inbox'), lakeRoot: path.join(root, 'lake'), sourceCode: 'daily-files',
    deliveryDate: '2026-09-16', now: Date.parse('2026-09-16T04:00:00+08:00'), contract: path.join(root, 'contract.json') };
  await mkdir(options.inbox); await writeFile(options.contract, JSON.stringify({ version: 1, ...contract }));
  const put = async (name, content, done = true) => {
    await writeFile(path.join(options.inbox, name), content);
    if (done) await writeFile(path.join(options.inbox, name + '.done'), '');
  };
  return { options, put, ledger: async () => JSON.parse(await readFile(path.join(options.lakeRoot, 'delivery-ledgers/daily-files/2026-09-16.json'))) };
}

test('daily set waits for every member; late arrival, duplicate and revisions retain history', async t => {
  const f = await fixture(t, { mode: 'DAILY_SET', expectedFiles: ['a.csv','b.csv'], dueTime: '03:00', allowContentRevision: true });
  assert.equal((await run(f.options)).deliveryState, 'MISSING');
  await f.put('a.csv', 'id\n1\n'); assert.equal((await run(f.options)).deliveryState, 'OVERDUE');
  await f.put('b.csv', 'id\n2\n', false); assert.equal((await run(f.options)).deliveryState, 'WAITING_READY');
  await f.put('b.csv.done', '', false);
  const first = await run(f.options); assert.equal(first.deliveryState, 'LATE'); assert.equal(first.rows, 2);
  const replay = await run(f.options); assert.equal(replay.deliveryState, 'DUPLICATE'); assert.equal(replay.rows, 2);
  await f.put('a.csv', 'id\n3\n'); assert.equal((await run(f.options)).deliveryState, 'REVISED');
  assert.equal((await f.ledger()).revisions.length, 2);
});

test('stable readiness requires separated observations and records heuristic confidence', async t => {
  const f = await fixture(t, { mode: 'DAILY_SET', expectedFiles: ['a.csv'], readiness: 'STABLE', stableMs: 1000 });
  await f.put('a.csv', 'id\n1\n', false);
  assert.equal((await run(f.options)).deliveryState, 'WAITING_READY');
  assert.equal((await run({ ...f.options, now: f.options.now + 500 })).deliveryState, 'WAITING_READY');
  const result = await run({ ...f.options, now: f.options.now + 1001 });
  assert.equal(result.state, 'COMPLETE'); assert.equal(result.confidence, 'HEURISTIC');
});

test('manifest logical identity survives rename and seals exact control evidence', async t => {
  const f = await fixture(t, { mode: 'MANIFEST' });
  await f.put('a.csv', 'id\n1\n', false);
  const manifest = { deliveryDate: f.options.deliveryDate, revision: 1, files: [{ path: 'a.csv', logicalId: 'orders', sha256: digest('id\n1\n') }] };
  const bytes = JSON.stringify(manifest, null, 2); await f.put('_delivery.json', bytes);
  const first = await run(f.options); assert.equal(first.state, 'COMPLETE');
  assert.equal(await readFile(path.join(f.options.lakeRoot, 'delivery-ledgers/daily-files', first.manifestHash + '.manifest.json'), 'utf8'), bytes);
  await rename(path.join(f.options.inbox, 'a.csv'), path.join(f.options.inbox, 'renamed.csv'));
  manifest.files[0].path = 'renamed.csv'; await f.put('_delivery.json', JSON.stringify(manifest));
  const result = await run(f.options); assert.equal(result.deliveryState, 'DUPLICATE'); assert.equal(result.duplicates, 1); assert.equal(result.rows, 1);
  await f.put('renamed.csv', 'id\n2\n', false);
  assert.equal((await run(f.options)).errorCode, 'DELIVERY_HASH_MISMATCH');
  manifest.files[0].sha256 = digest('id\n2\n'); await f.put('_delivery.json', JSON.stringify(manifest));
  assert.equal((await run(f.options)).deliveryState, 'REVIEW_REQUIRED');
  manifest.revision = 2; await f.put('_delivery.json', JSON.stringify(manifest));
  assert.equal((await run(f.options)).deliveryState, 'REVISED');
});

test('empty signals, disconnected folders and unapproved changes cannot mean successful delivery', async t => {
  const f = await fixture(t, { mode: 'MANIFEST', allowEmpty: true });
  await f.put('_delivery.json', JSON.stringify({ deliveryDate: f.options.deliveryDate, revision: 1, files: [] }));
  assert.equal((await run(f.options)).errorCode, 'EMPTY_DELIVERY_SIGNAL_REQUIRED');
  await f.put('_delivery.json', JSON.stringify({ deliveryDate: f.options.deliveryDate, revision: 1, files: [], empty: true }));
  assert.equal((await run(f.options)).deliveryState, 'EMPTY_CONFIRMED');
  assert.equal((await run({ ...f.options, inbox: path.join(f.options.inbox, 'unmounted') })).deliveryState, 'DIRECTORY_UNAVAILABLE');
});

test('event mode seals ready members while unfinished files remain visible', async t => {
  const f = await fixture(t, { mode: 'EVENT' });
  await f.put('a.csv', 'id\n1\n'); await f.put('b.csv', 'id\n2\n', false);
  const result = await run(f.options); assert.equal(result.state, 'INCOMPLETE'); assert.equal(result.rows, 1); assert.equal(result.waitingCount, 1);
  await f.put('b.csv.done', '', false); assert.equal((await run(f.options)).state, 'COMPLETE');
});

test('parser settings change creates a new processing record and keeps sealed originals', async t => {
  const f = await fixture(t, { mode: 'DAILY_SET', expectedFiles: ['a.csv'], parser: { delimiter: ';' } });
  await f.put('a.csv', 'id;value\n1;NULL\n');
  const first = await run(f.options); assert.equal(first.state, 'COMPLETE');
  const contract = JSON.parse(await readFile(f.options.contract)); contract.parser.nullValues = ['NULL']; await writeFile(f.options.contract, JSON.stringify(contract));
  const result = await run(f.options); assert.equal(result.deliveryState, 'REPROCESSED');
  const batch = JSON.parse(await readFile(path.join(f.options.lakeRoot, 'file-batches', result.batchId, 'batch.json')));
  assert.deepEqual(JSON.parse(await readFile(path.join(f.options.lakeRoot, batch.entries[0].parsedPath))), { id: '1', value: null });
  assert.equal((await f.ledger()).revisions.length, 2);
});

test('Excel selection applies range and uncached formula fails without losing the original', async t => {
  const f = await fixture(t, { mode: 'DAILY_SET', expectedFiles: ['a.xlsx'], parser: { sheets: ['Data'], range: 'B2:C3' } });
  const python = process.env.LAKE_PYTHON || 'python3';
  const script = 'import openpyxl,sys\nw=openpyxl.Workbook();s=w.active;s.title="Data";s["B2"]="id";s["C2"]="value";s["B3"]=1;s["C3"]="=1+1";w.save(sys.argv[1])';
  assert.equal(spawnSync(python, ['-c', script, path.join(f.options.inbox, 'a.xlsx')]).status, 0);
  await f.put('a.xlsx.done', '', false);
  const result = await run(f.options); assert.equal(result.state, 'FAILED'); assert.equal(result.rawState, 'RECEIVED');
});
