import test from 'node:test';
import assert from 'node:assert/strict';
import { channelSettings } from '../apps/console/src/views/ingestion/channelSettings.ts';

const form = {
  sourceMode: 'TABLE_LIST', mysqlTables: '', path: '/orders', pagination: 'none',
  apiRecordsPath: '', pageSize: 100, maxPages: 1000, nextPath: '', cursorParam: 'cursor',
  successPath: '', successValue: 'true', relativeDirectory: '', datePartitioned: true,
  mode: 'DAILY_SET', readiness: 'DONE', expectedFiles: '', allowEmpty: false,
  allowContentRevision: false, stableMs: 120000, dueTime: '09:00', dueDayOffset: 0,
  format: 'csv', encoding: 'utf-8-sig', delimiter: ',', sheets: '', range: '', recordsPath: '',
  formulaPolicy: 'cached',
};

test('a MySQL channel with no table list asks for the whole approved schema', () => {
  assert.deepEqual(channelSettings({ kind: 'MYSQL_SNAPSHOT', form }), { sourceMode: 'TABLE_LIST' });
});

test('a registered-SQL channel sends only its mode: the definition lives in the version', () => {
  const result = channelSettings({ kind: 'MYSQL_SNAPSHOT', form: { ...form, sourceMode: 'REGISTERED_SQL' } });
  assert.deepEqual(result, { sourceMode: 'REGISTERED_SQL' });
});

test('a table list is trimmed and blank lines dropped', () => {
  const result = channelSettings({ kind: 'MYSQL_SNAPSHOT', form: { ...form, mysqlTables: ' orders \n\n customer \n' } });
  assert.deepEqual(result, { tables: ['orders', 'customer'] });
});

test('a file channel keeps the delivery contract and the format-specific parser settings', () => {
  const csv = channelSettings({ kind: 'FILE_SCAN', form: { ...form, expectedFiles: 'orders.csv\n', delimiter: ';' } });
  assert.equal(csv.delivery.mode, 'DAILY_SET');
  assert.deepEqual(csv.delivery.expectedFiles, ['orders.csv']);
  assert.equal(csv.delivery.parser.delimiter, ';');
  const xlsx = channelSettings({ kind: 'FILE_SCAN', form: { ...form, format: 'xlsx', sheets: 'Data', range: 'B2:C3' } });
  assert.deepEqual(xlsx.delivery.parser.sheets, ['Data']);
  assert.equal(xlsx.delivery.parser.range, 'B2:C3');
  const json = channelSettings({ kind: 'FILE_SCAN', form: { ...form, format: 'json', recordsPath: 'payload.items' } });
  assert.equal(json.delivery.parser.recordsPath, 'payload.items');
});

test('a REST channel restates its path and pagination on top of the connection template', () => {
  const result = channelSettings({
    kind: 'REST_PULL',
    form: { ...form, path: '/v2/orders', pagination: 'page', apiRecordsPath: 'data.items', pageSize: 50 },
    base: { base_url: 'https://example.invalid', allowed_hosts: ['example.invalid'], pagination: { mode: 'none' } },
  });
  assert.equal(result.path, '/v2/orders');
  assert.equal(result.pagination.mode, 'page');
  assert.equal(result.pagination.records_path, 'data.items');
  assert.equal(result.pagination.page_size, 50);
  assert.equal(result.base_url, 'https://example.invalid');
});
