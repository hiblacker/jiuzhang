import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, run } from '../tools/lake-daily.mjs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('daily orchestrator requires an explicit valid window when supplied', () => {
  const parsed = parseArgs(['--window', '2026-09-15', '--allow-unverified-test-tls', '--require-api']);
  assert.equal(parsed.window, '2026-09-15');
  assert.equal(parsed.requireApi, true);
  assert.equal(parsed.allowUnverifiedTestTls, true);
  assert.throws(() => parseArgs(['--window', '2026-09-15', '--register']), /CONTROL_API_REQUIRED_FOR_REGISTER/);
  assert.equal(parseArgs(['--window', '2026-09-15', '--register', '--control-api', 'http://127.0.0.1:8080']).register, true);
  assert.throws(() => parseArgs(['--window', 'today']), /INVALID_WINDOW/);
});

test('dry run does not create a success ledger or a lake directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-daily-review-'));
  try {
    const lake = path.join(root, 'lake');
    const options = parseArgs(['--lake-root', lake, '--dry-run', '--register', '--control-api', 'http://127.0.0.1:8080']);
    const result = await run(options, async () => ({ state: 'DRY_RUN' }));
    assert.equal(result.state, 'DRY_RUN');
    await assert.rejects(access(lake), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('repeating a daily orchestration still scans for late files and new registration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-late-files-'));
  try {
    let files = 0; let register = 0;
    const execute = async (script) => {
      if (script.endsWith('/file-ingest.mjs')) files++;
      if (script.endsWith('/lake-register.mjs')) register++;
      return { state: 'COMPLETE', batchId: 'same-db-batch', reused: true };
    };
    const args = ['--lake-root', root, '--inbox', '/configured/inbox'];
    await run(parseArgs(args), execute);
    await run(parseArgs([...args, '--register', '--control-api', 'http://127.0.0.1:8080']), execute);
    assert.equal(files, 2);
    assert.equal(register, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
