// Unit tests for the datasource connection test: no database is contacted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientConfig, classifyError, parseVersionRow } from '../tools/datasource-test.mjs';

test('client config pins host, port, charset and disables local infile', () => {
  const text = buildClientConfig({ host: 'source-mysql', port: 3306, charset: 'utf8mb4' }, { user: 'ro', password: 'synthetic' });
  assert.match(text, /^\[client\]\n/);
  assert.match(text, /host=source-mysql/);
  assert.match(text, /port=3306/);
  assert.match(text, /user=ro/);
  assert.match(text, /default-character-set=utf8mb4/);
  assert.match(text, /local-infile=0/);
  assert.match(text, /connect-timeout=10/);
  assert.match(buildClientConfig({ host: 'h', port: 3306, database: 'erp' }, { user: 'ro', password: 'x' }), /database=erp/);
});

test('error classification maps the failures an operator can act on', () => {
  assert.equal(classifyError("ERROR 1045 (28000): Access denied for user 'ro'@'host'"), 'DATASOURCE_AUTH_FAILED');
  assert.equal(classifyError("ERROR 2002 (HY000): Can't connect to MySQL server on 'db'"), 'DATASOURCE_UNREACHABLE');
  assert.equal(classifyError('ERROR 2026 (HY000): SSL connection error'), 'DATASOURCE_TLS_FAILED');
  assert.equal(classifyError('something else'), 'DATASOURCE_TEST_FAILED');
});

test('version row parsing keeps the server timezone for the audit trail', () => {
  assert.deepEqual(parseVersionRow('8.0.43\tUTC\n21\n'), { serverVersion: '8.0.43', serverTimezone: 'UTC' });
  assert.deepEqual(parseVersionRow(''), { serverVersion: '', serverTimezone: '' });
});
