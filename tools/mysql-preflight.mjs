import fs from 'node:fs/promises';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const MAX_PACKET_BYTES = 4096;

// Only classify credentials locally. Never return their values or a raw exception.
export function summarizeConfig(c) {
  return {
    required_fields_present: Object.fromEntries(
      ['engine', 'host', 'port', 'database', 'username', 'password'].map(k => [k, Boolean(c?.[k])])
    ),
    mysql_engine_declared: /^mysql\b/i.test(String(c?.engine ?? '')),
    admin_style_username: ['root', 'sa', 'admin'].includes(String(c?.username ?? '').trim().toLowerCase()),
    tls_requires_encryption: c?.tls?.require_encryption === true,
    tls_verifies_certificate: c?.tls?.verify_server_certificate === true,
    ca_configured: Boolean(c?.tls?.ca_cert_file),
    metadata_only: c?.access?.metadata_only === true,
    business_samples_allowed: c?.access?.allow_business_row_samples === true,
  };
}

export function parseGreeting(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 4) throw new Error('INCOMPLETE_GREETING');
  const size = frame.readUIntLE(0, 3);
  if (size > MAX_PACKET_BYTES - 4) throw new Error('GREETING_TOO_LARGE');
  if (frame.length < size + 4) throw new Error('INCOMPLETE_GREETING');
  const p = frame.subarray(4, size + 4);
  if (frame[3] !== 0 || p[0] !== 10) throw new Error('UNEXPECTED_GREETING');
  const end = p.indexOf(0, 1);
  if (end < 2 || end > 128 || p.length < end + 16) throw new Error('INVALID_GREETING');
  // Extract only a numeric version, never log the server-supplied banner or salt.
  const version = p.subarray(1, end).toString('ascii').match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})(?:[-\s]|$)/)?.[1] ?? null;
  const capabilities = p.readUInt16LE(end + 14);
  return { protocol: 10, server_version_numeric: version, tls_advertised: Boolean(capabilities & 0x0800) };
}

// A single bounded connection: no socket.write(), authentication, TLS negotiation or SQL.
export async function probeGreeting(c) {
  const host = c?.host;
  const port = Number(c?.port);
  if (typeof host !== 'string' || !host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { status: 'INVALID_TARGET' };
  }
  const configured = Number(c?.limits?.connect_timeout_seconds);
  const timeout = Number.isFinite(configured) && configured > 0 ? Math.min(configured * 1000, 10000) : 10000;
  return new Promise(resolve => {
    let socket;
    let timer;
    let done = false;
    let bytes = Buffer.alloc(0);
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(value);
    };
    timer = setTimeout(() => finish({ status: 'TIMEOUT' }), timeout);
    try {
      socket = net.createConnection({ host, port });
      socket.on('error', () => finish({ status: 'CONNECTION_FAILED' }));
      socket.on('close', () => finish({ status: 'CLOSED_BEFORE_GREETING' }));
      socket.on('data', chunk => {
        if (bytes.length + chunk.length > MAX_PACKET_BYTES) return finish({ status: 'GREETING_TOO_LARGE' });
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length < 4) return;
        const size = bytes.readUIntLE(0, 3);
        if (size > MAX_PACKET_BYTES - 4) return finish({ status: 'GREETING_TOO_LARGE' });
        if (bytes.length < size + 4) return;
        try { finish({ status: 'GREETING_RECEIVED', ...parseGreeting(bytes) }); }
        catch { finish({ status: 'UNEXPECTED_GREETING' }); }
      });
    } catch { finish({ status: 'CONNECTION_FAILED' }); }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(x => x !== '--probe') || args.length > 1) {
    console.log('USAGE: node tools/mysql-preflight.mjs [--probe]');
    process.exitCode = 1;
    return;
  }
  let config;
  try { config = JSON.parse((await fs.readFile('secrets/devops-db.local.json', 'utf8')).replace(/^\uFEFF/, '')); }
  catch { console.log('CONFIG_INVALID_OR_UNREADABLE'); process.exitCode = 1; return; }
  const report = {
    observed_at: new Date().toISOString(),
    config: summarizeConfig(config),
    network: { status: 'NOT_REQUESTED' },
    authentication_attempted: false,
    sql_executed: false,
    tls_negotiated: false,
    note: 'Numeric greeting version is unauthenticated, not SELECT VERSION() evidence. Account privileges are not inspected.',
  };
  if (args.includes('--probe')) report.network = await probeGreeting(config);
  await fs.mkdir('work', { recursive: true });
  await fs.writeFile('work/mysql-preflight-result.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (args.includes('--probe') && report.network.status !== 'GREETING_RECEIVED') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => { console.log('PREFLIGHT_FAILED'); process.exitCode = 1; });
}
