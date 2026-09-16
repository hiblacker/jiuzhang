import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

export function digest(value) { return createHash('sha256').update(value).digest('hex'); }

export function validateDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(day)
      || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))
      || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('INVALID_WINDOW');
  return day;
}

export function currentDay() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); }

export function dayBounds(day) {
  validateDay(day);
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { start: `${day}T00:00:00+08:00`, end: `${next}T00:00:00+08:00`, nextDay: next };
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error('LAKE_METADATA_UNREADABLE', { cause: error });
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function durableRename(from, to) {
  const file = await open(from, 'r');
  try { await file.sync(); } finally { await file.close(); }
  await rename(from, to);
  await syncDirectory(path.dirname(to));
}

export async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.part`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, file);
  await syncDirectory(path.dirname(file));
}

export async function hashFile(file) {
  const hash = createHash('sha256'); let bytes = 0; let rows = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk); bytes += chunk.length;
    for (const value of chunk) if (value === 10) rows += 1;
  }
  return { sha256: hash.digest('hex'), bytes, rows };
}

// Preserve integer identifiers and decimal spellings before JS Number can round
// them. Small integers stay numeric; exact decimal/large-integer values use text.
export function parseExactJson(text) {
  return JSON.parse(text, (key, value, context) => {
    if (typeof value !== 'number') return value;
    if (!context?.source) throw new Error('EXACT_JSON_RUNTIME_REQUIRED');
    return !Number.isSafeInteger(value) || /[.eE]/u.test(context.source) ? context.source : value;
  });
}

export async function resolveInside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]/u).includes('..')) throw new Error('LAKE_PATH_OUTSIDE_ROOT');
  const actualRoot = await realpath(root);
  const actual = await realpath(path.join(root, relative));
  const rel = path.relative(actualRoot, actual);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('LAKE_PATH_OUTSIDE_ROOT');
  return actual;
}

export async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === 'linux') {
      const [stat, boot] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile('/proc/sys/kernel/random/boot_id', 'utf8')]);
      return `${boot.trim()}:${stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u)[19]}`;
    }
    const { stdout } = await promisify(execFile)('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2000 });
    return stdout.trim() || null;
  } catch { return null; }
}

async function dead(owner) {
  if (owner.host !== hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) return false;
  try { process.kill(owner.pid, 0); } catch (error) { return error.code === 'ESRCH'; }
  const current = owner.processStart ? await processIdentity(owner.pid) : null;
  return Boolean(current && current !== owner.processStart);
}

// Local-host process lock. Never reclaim an empty/ambiguous/live lock. A separate
// recovery mutex serializes reapers so an old owner cannot remove a new lock.
export async function withLock(file, operation) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const owner = { pid: process.pid, host: hostname(), token: randomUUID(), processStart: await processIdentity(process.pid) };
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recovery = `${file}.recovery`;
    try { await mkdir(recovery); } catch { throw new Error('LAKE_RUN_BUSY'); }
    try {
      const previous = await readJson(file);
      if (!await dead(previous)) throw new Error('LAKE_RUN_BUSY');
      await rm(file);
      handle = await open(file, 'wx', 0o600);
    } finally { await rm(recovery, { recursive: true }); }
  }
  try {
    await handle.writeFile(JSON.stringify(owner)); await handle.sync();
    return await operation();
  } finally {
    await handle.close();
    const current = await readJson(file);
    if (current.token === owner.token) await rm(file);
  }
}
