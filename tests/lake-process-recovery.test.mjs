import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { reprocess as fileReprocess } from '../tools/file-reprocess.mjs';
import { reprocess as apiReprocess } from '../tools/api-reprocess.mjs';

const waitFor = async file => {
  for (let i = 0; i < 200; i++) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('CHECKPOINT_TIMEOUT');
};

for (const files of [1, 2]) test(`SIGKILL during file parsing preserves raw evidence and ${files === 1 ? 'complete' : 'incomplete'} membership`, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-kill-file-')); t.after(() => rm(root, { recursive: true, force: true }));
  const inbox = path.join(root, 'inbox'), lakeRoot = path.join(root, 'lake'); await mkdir(inbox);
  await writeFile(path.join(inbox, 'first.csv'), 'id\n001\n');
  if (files === 2) await writeFile(path.join(inbox, 'second.csv'), 'id\n002\n');
  const parser = path.join(root, 'slow-parser');
  await writeFile(parser, '#!/usr/bin/env python3\nimport time\ntime.sleep(60)\n', { mode: 0o700 });
  const process = spawn(globalThis.process.execPath, ['tools/file-ingest.mjs', '--inbox', inbox, '--lake-root', lakeRoot,
    '--source-code', 'synthetic', '--delivery-date', '2026-09-16', '--batch-id', 'exec-901', '--assume-ready', '--parser-python', parser],
    { detached: true, stdio: 'ignore' });
  const closed = once(process, 'close');
  try {
    const checkpoint = await waitFor(path.join(lakeRoot, 'file-batches/exec-901/batch.json.part'));
    assert.equal(checkpoint.expectedFileCount, files); assert.equal(checkpoint.entries.length, 1);
    globalThis.process.kill(-process.pid, 'SIGKILL'); await closed;
    await rm(inbox, { recursive: true });
    const repaired = await fileReprocess({ lakeRoot, batchId: 'exec-901' });
    assert.equal(repaired.state, files === 1 ? 'COMPLETE' : 'INCOMPLETE');
    assert.equal(repaired.entries[0].rows, 1);
    assert.equal(await readFile(path.join(lakeRoot, checkpoint.entries[0].rawPath), 'utf8'), 'id\n001\n');
  } finally { try { globalThis.process.kill(-process.pid, 'SIGKILL'); } catch {} await closed; }
});

test('SIGKILL during API pagination replays sealed responses with the API shut down', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-kill-api-')); t.after(() => rm(root, { recursive: true, force: true }));
  let requests = 0, second;
  const reachedSecond = new Promise(resolve => { second = resolve; });
  const server = http.createServer((req, res) => { requests++; if (requests === 1) res.end('[{"id":"001"}]'); else second(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const config = path.join(root, 'api.json'), lakeRoot = path.join(root, 'lake');
  await writeFile(config, JSON.stringify({ version: 1, source_code: 'synthetic', base_url: `http://127.0.0.1:${server.address().port}`, path: '/data',
    pagination: { mode: 'page', page_size: 1 }, requests_per_second: 100 }));
  const process = spawn(globalThis.process.execPath, ['tools/rest-ingest.mjs', '--config', config, '--lake-root', lakeRoot, '--window', '2026-09-16', '--batch-id', 'exec-902'], { stdio: 'ignore' });
  const closed = once(process, 'close');
  try {
    await Promise.race([reachedSecond, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('PAGE_TIMEOUT')), 5000); timer.unref(); })]);
    process.kill('SIGKILL'); await closed;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const repaired = await apiReprocess({ config, lakeRoot, batchId: 'exec-902', window: '2026-09-16' });
    assert.equal(repaired.state, 'INCOMPLETE'); assert.equal(repaired.rowCount, 1); assert.equal(requests, 2);
    assert.equal(repaired.errorCode, 'RAW_PAGESET_INCOMPLETE');
  } finally { process.kill('SIGKILL'); await closed; }
});
