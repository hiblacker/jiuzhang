import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatFor, parseArgs, readyFor, scanDirectory } from '../tools/file-ingest.mjs';
import { parseExactJson } from '../tools/lake-runtime.mjs';

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

test('nested and flattened filenames keep separate immutable raw objects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-file-collision-'));
  try {
    const inbox = path.join(root, 'inbox'); const lakeRoot = path.join(root, 'lake');
    await mkdir(path.join(inbox, 'a'), { recursive: true });
    await writeFile(path.join(inbox, 'a', 'b.csv'), 'id\nfirst\n');
    await writeFile(path.join(inbox, 'a__b.csv'), 'id\nsecond\n');
    const result = await scanDirectory({ inbox, lakeRoot, assumeReady: true });
    assert.equal(result.state, 'COMPLETE');
    assert.notEqual(result.entries[0].rawPath, result.entries[1].rawPath);
    assert.match(await readFile(path.join(lakeRoot, result.entries[0].rawPath), 'utf8'), /first/);
    assert.match(await readFile(path.join(lakeRoot, result.entries[1].rawPath), 'utf8'), /second/);
    assert.equal((await scanDirectory({ inbox, lakeRoot, assumeReady: true })).entries[0].state, 'DUPLICATE');
    await writeFile(path.join(lakeRoot, result.entries[0].rawPath), 'corrupt');
    await assert.rejects(scanDirectory({ inbox, lakeRoot, assumeReady: true }), /FILE_REPLAY_INTEGRITY_MISMATCH/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('malformed files terminate and header aliases cannot silently discard columns', { timeout: 5000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-file-errors-'));
  try {
    const inbox = path.join(root, 'inbox'); await mkdir(inbox);
    await writeFile(path.join(inbox, 'bad.json'), '{');
    await writeFile(path.join(inbox, 'bad.csv'), 'id,id,id__2\n1,2,3\n');
    const result = await scanDirectory({ inbox, lakeRoot: path.join(root, 'lake'), assumeReady: true });
    assert.equal(result.state, 'FAILED');
    assert.deepEqual(result.entries.map(x => x.state), ['FAILED', 'FAILED']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the parser reads the sealed copy even if the delivery file changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-file-sealed-'));
  try {
    const inbox = path.join(root, 'inbox'); await mkdir(inbox);
    const original = path.join(inbox, 'data.json'); await writeFile(original, '{"id":"original"}');
    const parser = path.join(root, 'parser');
    await writeFile(parser, '#!/usr/bin/env node\n' +
      'const fs=require("node:fs"); const a=process.argv; fs.writeFileSync(' + JSON.stringify(original) + ',\'{"id":"changed"}\');' +
      'fs.writeFileSync(a[a.indexOf("--output")+1], fs.readFileSync(a[a.indexOf("--input")+1])); console.log(\'{"rows":1}\');', { mode: 0o700 });
    const lakeRoot = path.join(root, 'lake');
    const result = await scanDirectory({ inbox, lakeRoot, assumeReady: true, parserPython: parser });
    assert.equal(result.state, 'COMPLETE');
    assert.deepEqual(JSON.parse(await readFile(path.join(lakeRoot, result.entries[0].parsedPath))), { id: 'original' });
  } finally { await rm(root, { recursive: true, force: true }); }
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

test('JSON and JSONL preserve decimal text and large integers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lake-json-exact-'));
  try {
    const inbox = path.join(root, 'inbox'); const lakeRoot = path.join(root, 'lake'); await mkdir(inbox);
    const row = '{"id":9007199254740993,"amount":12345.67890123456789}';
    await writeFile(path.join(inbox, 'data.jsonl'), row + '\n');
    await writeFile(path.join(inbox, 'data.json'), '[' + row + ']');
    const result = await scanDirectory({ inbox, lakeRoot, assumeReady: true });
    assert.equal(result.state, 'COMPLETE');
    for (const entry of result.entries) {
      assert.equal(entry.rows, 1);
      assert.deepEqual(parseExactJson(await readFile(path.join(lakeRoot, entry.parsedPath), 'utf8')),
        { id: '9007199254740993', amount: '12345.67890123456789' });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('XLSX sheets and Parquet decimals parse with the declared Python dependencies',
  { skip: !process.env.LAKE_PYTHON }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lake-binary-formats-'));
    try {
      const inbox = path.join(root, 'inbox'); const lakeRoot = path.join(root, 'lake'); await mkdir(inbox);
      const fixture = spawnSync(process.env.LAKE_PYTHON, ['-c', `
import pathlib, sys, decimal, datetime
import openpyxl, pyarrow as pa, pyarrow.parquet as pq
root = pathlib.Path(sys.argv[1])
book = openpyxl.Workbook()
book.active.title = "first"
for sheet in [book.active, book.create_sheet("second")]:
    sheet.append(["id", "amount"])
    sheet.append(["9007199254740993", "12345.67890123456789"])
book.save(root / "data.xlsx")
pq.write_table(pa.table({"id": pa.array([9007199254740993], type=pa.int64()),
    "amount": pa.array([decimal.Decimal("12345.67890123456789")], type=pa.decimal128(25,14)),
    "day": [datetime.date(2026,9,16)]}), root / "data.parquet")
`, inbox], { encoding: 'utf8' });
      assert.equal(fixture.status, 0, fixture.stderr);
      const result = await scanDirectory({ inbox, lakeRoot, assumeReady: true });
      assert.equal(result.state, 'COMPLETE');
      for (const entry of result.entries) {
        const rows = (await readFile(path.join(lakeRoot, entry.parsedPath), 'utf8')).trim().split('\n').map(parseExactJson);
        assert.equal(rows.length, entry.format === 'xlsx' ? 2 : 1);
        for (const row of rows) { assert.equal(row.id, '9007199254740993'); assert.equal(row.amount, '12345.67890123456789'); }
        if (entry.format === 'xlsx') assert.deepEqual(rows.map(row => row._sheet), ['first', 'second']);
        else assert.equal(rows[0].day, '2026-09-16');
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
