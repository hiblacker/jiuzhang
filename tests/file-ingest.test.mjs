import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatFor, parseArgs, readyFor, scanDirectory } from '../tools/file-ingest.mjs';

test('file formats are explicit and transfer-tool agnostic', () => {
  assert.equal(formatFor('/inbox/a.csv'), 'csv');
  assert.equal(formatFor('/inbox/a.xlsx'), 'xlsx');
  assert.equal(formatFor('/inbox/a.json'), 'json');
  assert.equal(formatFor('/inbox/a.jsonl'), 'jsonl');
  assert.equal(formatFor('/inbox/a.parquet'), 'parquet');
  assert.equal(formatFor('/inbox/a.xls'), null);
  assert.equal(readyFor('/inbox/a.csv', false), false);
  assert.equal(readyFor('/inbox/a.csv', true), true);
});

test('directory parser bounds source and delivery inputs', () => {
  const parsed = parseArgs(['--inbox', '/tmp/inbox', '--source-code', 'daily-files', '--delivery-date', '2026-09-15', '--assume-ready']);
  assert.equal(parsed.sourceCode, 'daily-files');
  assert.throws(() => parseArgs(['--source-code', '../escape', '--inbox', '/tmp/inbox']), /INVALID_SOURCE_CODE/);
  assert.throws(() => parseArgs(['--inbox', '/tmp/inbox', '--delivery-date', 'today']), /INVALID_DELIVERY_DATE/);
  assert.throws(() => parseArgs(['--inbox', '/tmp/inbox', '--max-rows', '0']), /INVALID_MAX_ROWS/);
  assert.equal(parseArgs(['--inbox', '/tmp/inbox', '--json-records-path', 'data.items']).jsonRecordsPath, 'data.items');
  assert.throws(() => parseArgs(['--source-code', 'x']), /INBOX_REQUIRED/);
});

test('unsupported legacy Excel files are visible as incomplete delivery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiuzhang-file-'));
  try {
    const inbox = path.join(root, 'inbox'); const lake = path.join(root, 'lake');
    await mkdir(inbox, { recursive: true });
    await writeFile(path.join(inbox, 'legacy.xls'), 'not parsed');
    const result = await scanDirectory({ inbox, lakeRoot: lake, sourceCode: 'test-files', deliveryDate: '2026-09-15', assumeReady: true, dryRun: false, parserPython: process.env.PYTHON ?? 'python3' });
    assert.equal(result.state, 'INCOMPLETE');
    assert.equal(result.entries[0].state, 'UNSUPPORTED_FORMAT');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('JSON record paths expand an object envelope without inventing values', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiuzhang-json-'));
  try {
    const inbox = path.join(root, 'inbox'); const lake = path.join(root, 'lake');
    await mkdir(inbox, { recursive: true });
    await writeFile(path.join(inbox, 'envelope.json'), JSON.stringify({ data: { items: [{ id: 1 }, { id: 2 }] } }));
    await writeFile(path.join(inbox, 'envelope.json.done'), '');
    const result = await scanDirectory({ inbox, lakeRoot: lake, sourceCode: 'test-json', deliveryDate: '2026-09-15', assumeReady: false, dryRun: false, jsonRecordsPath: 'data.items', parserPython: process.env.PYTHON ?? 'python3' });
    assert.equal(result.state, 'COMPLETE');
    assert.equal(result.entries[0].rows, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
