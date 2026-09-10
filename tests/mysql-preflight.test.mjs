import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { summarizeConfig, parseGreeting, probeGreeting } from '../tools/mysql-preflight.mjs';

function greeting(version = '8.1.0', tls = true) {
  const versionBytes = Buffer.from(version + '\0');
  const body = Buffer.alloc(1 + versionBytes.length + 20);
  body[0] = 10;
  versionBytes.copy(body, 1);
  body.writeUInt16LE(tls ? 0x0800 : 0, 1 + versionBytes.length + 13);
  const header = Buffer.alloc(4);
  header.writeUIntLE(body.length, 0, 3);
  return Buffer.concat([header, body]);
}

test('config summary never returns credential values', () => {
  const summary = summarizeConfig({ engine: 'mysql', host: 'secret-host', username: 'root', password: 'secret-password' });
  assert.equal(summary.admin_style_username, true);
  assert.equal(summary.mysql_engine_declared, true);
  assert.doesNotMatch(JSON.stringify(summary), /secret-host|secret-password|"root"/);
  assert.doesNotThrow(() => summarizeConfig(null));
});
test('greeting extracts numeric version and SSL capability only', () => {
  assert.deepEqual(parseGreeting(greeting('8.1.0-private-banner')), { protocol: 10, server_version_numeric: '8.1.0', tls_advertised: true });
  assert.equal(parseGreeting(greeting('8.0.0', false)).tls_advertised, false);
  assert.equal(parseGreeting(greeting('untrusted-banner')).server_version_numeric, null);
});
test('malformed, truncated, oversized and non-initial packets rejected', () => {
  assert.throws(() => parseGreeting(Buffer.alloc(2)));
  assert.throws(() => parseGreeting(greeting().subarray(0, 6)));
  const large = Buffer.alloc(4); large.writeUIntLE(5000, 0, 3);
  assert.throws(() => parseGreeting(large));
  const invalid = greeting(); invalid[4] = 0xff;
  assert.throws(() => parseGreeting(invalid));
  const sequence = greeting(); sequence[3] = 1;
  assert.throws(() => parseGreeting(sequence));
});
test('invalid destination rejected before network access', async () => {
  assert.deepEqual(await probeGreeting({ host: 'localhost', port: 0 }), { status: 'INVALID_TARGET' });
});
test('fragmented server greeting received without transmitting any client bytes', async t => {
  let clientBytes = 0;
  const server = net.createServer(socket => {
    socket.on('data', bytes => { clientBytes += bytes.length; });
    socket.on('error', () => {});
    const frame = greeting();
    socket.write(frame.subarray(0, 2));
    setImmediate(() => socket.end(frame.subarray(2)));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await probeGreeting({ host: '127.0.0.1', port: server.address().port });
  assert.equal(result.status, 'GREETING_RECEIVED');
  assert.equal(clientBytes, 0);
});
test('silent server times out and disconnects without sending credentials', async t => {
  let clientBytes = 0;
  const server = net.createServer(socket => { socket.on('data', b => { clientBytes += b.length; }); socket.on('error', () => {}); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await probeGreeting({ host: '127.0.0.1', port: server.address().port, limits: { connect_timeout_seconds: 0.05 } });
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(clientBytes, 0);
});
