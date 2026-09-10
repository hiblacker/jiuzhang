import test from 'node:test';
import assert from 'node:assert/strict';
import { optionValue, makeOptions, classifyResult, IMAGE } from '../tools/mysql-discover.mjs';
const fixture = () => ({ engine: 'mysql', host: 'synthetic.invalid', port: 3306,
  username: 'synthetic-user', password: 'synthetic-password',
  tls: { require_encryption: true, verify_server_certificate: true } });

test('pinned cached image ID has no mutable tag', () => {
  assert.match(IMAGE, /^sha256:[a-f0-9]{64}$/);
});
test('option escaping blocks line injection and preserves special characters', () => {
  assert.equal(optionValue('a\\b"c\nd\re\tf#;'), '"a\\\\b\\"c\\nd\\re\\tf#;"');
  assert.equal(optionValue('a\n[client]\nssl-mode=DISABLED').split('\n').length, 1);
  assert.throws(() => optionValue('a\0b'));
  assert.throws(() => optionValue(undefined));
});
test('strict TLS with CA, TCP and local infile disabled', () => {
  const options = makeOptions(fixture());
  assert.match(options, /ssl-mode=VERIFY_IDENTITY/);
  assert.match(options, /ssl-ca="\/etc\/pki\/tls\/certs\/ca-bundle.crt"/);
  assert.match(options, /local-infile=0/);
  assert.match(options, /connect-timeout=10/);
  assert.match(makeOptions(fixture(), '/run/secrets/mysql/ca.pem'), /ssl-ca="\/run\/secrets\/mysql\/ca.pem"/);
});
test('unsafe config fails closed', () => {
  for (const field of ['require_encryption', 'verify_server_certificate']) {
    const config = fixture(); config.tls[field] = false;
    assert.throws(() => makeOptions(config));
  }
  for (const port of [0, 65536, '3306', 1.5]) assert.throws(() => makeOptions({ ...fixture(), port }));
  assert.throws(() => makeOptions({ ...fixture(), password: '' }));
});
test('connection timeout honors lower configured limit and caps larger value', () => {
  assert.match(makeOptions({ ...fixture(), limits: { connect_timeout_seconds: 3 } }), /connect-timeout=3/);
  assert.match(makeOptions({ ...fixture(), limits: { connect_timeout_seconds: 99 } }), /connect-timeout=10/);
  assert.throws(() => makeOptions({ ...fixture(), limits: { connect_timeout_seconds: -1 } }));
});
test('raw errors never leak host/user/password', () => {
  for (const [code, category] of [[1045, 'ACCESS_DENIED'], [2003, 'CONNECTION_FAILED'], [3024, 'QUERY_TIMEOUT'], [1064, 'MYSQL_QUERY_FAILED']]) {
    assert.deepEqual(classifyResult({ status: 1, stderr: `ERROR ${code}: synthetic-user synthetic-password synthetic.invalid` }),
      { status: 'failed', category, mysql_error_code: code });
  }
  assert.equal(classifyResult({ status: 0 }).status, 'succeeded');
  assert.equal(classifyResult({ error: { code: 'ETIMEDOUT' } }).category, 'CLIENT_TIMEOUT');
  assert.equal(classifyResult({ error: { code: 'ENOENT' } }).category, 'DOCKER_NOT_FOUND');
  assert.equal(classifyResult({ status: 125, stderr: 'private docker details' }).category, 'DOCKER_OR_CLIENT_FAILED');
});

test('TLS errors have redacted reasons, not assumed authentication success', () => {
  for (const [message, reason] of [['self-signed certificate', 'SELF_SIGNED_CERTIFICATE'], ['certificate verify failed', 'CERTIFICATE_TRUST_FAILED'], ['hostname mismatch', 'SERVER_IDENTITY_FAILED'], ['unknown private message', 'TLS_FAILURE_UNCLASSIFIED']]) {
    assert.deepEqual(classifyResult({ status: 1, stderr: 'ERROR 2026 ' + message }),
      { status: 'failed', category: 'TLS_CONNECTION_FAILED', mysql_error_code: 2026, tls_reason: reason });
  }
});
