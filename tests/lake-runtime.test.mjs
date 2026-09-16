import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dayBounds, parseExactJson, processIdentity, readJson, validateDay, withLock } from '../tools/lake-runtime.mjs';

test('days are real dates and API windows are half open over month boundaries', () => {
  assert.throws(() => validateDay('2026-02-30'), /INVALID_WINDOW/);
  assert.equal(dayBounds('2026-12-31').end, '2027-01-01T00:00:00+08:00');
  assert.deepEqual(parseExactJson('{"id":9007199254740993,"amount":0.1234567890123456789,"n":1}'),
    { id: '9007199254740993', amount: '0.1234567890123456789', n: 1 });
});

test('corrupt metadata fails closed and concurrent owners cannot share a lock', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-runtime-'));
  try {
    const lock = path.join(root, 'run.lock');
    await writeFile(path.join(root, 'ledger.json'), '{');
    await assert.rejects(readJson(path.join(root, 'ledger.json'), {}), /LAKE_METADATA_UNREADABLE/);
    await withLock(lock, async () => {
      await assert.rejects(withLock(lock, async () => assert.fail('second owner ran')), /LAKE_RUN_BUSY/);
    });
    await withLock(lock, async () => {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a reused PID does not keep an abandoned lock alive after a process restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-pid-reuse-'));
  try {
    assert.ok(await processIdentity(process.pid));
    const lock = path.join(root, 'run.lock');
    await writeFile(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'previous-process', processStart: 'previous-boot-or-start' }));
    let recovered = false;
    await withLock(lock, async () => { recovered = true; });
    assert.equal(recovered, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
