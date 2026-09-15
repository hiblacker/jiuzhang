import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { digest, hashFile, parseExactJson, readJson, resolveInside } from './lake-runtime.mjs';

async function observedSchema(root, relative) {
  if (!relative) return { provenance: 'NOT_PARSED', fields: [] };
  const file = await resolveInside(root, relative), stream = createReadStream(file), lines = createInterface({ input: stream, crlfDelay: Infinity });
  const fields = new Map(); let count = 0;
  try {
    for await (const line of lines) {
      if (Buffer.byteLength(line) > 1048576) break;
      if (!line.trim()) continue;
      const row = parseExactJson(line);
      for (const [name, value] of Object.entries(row)) {
        const types = fields.get(name) ?? new Set(); types.add(value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value); fields.set(name, types);
      }
      if (++count === 25) break;
    }
  } finally { lines.close(); stream.destroy(); }
  return { provenance: 'OBSERVED_SAMPLE', sampledRows: count, fields: [...fields].map(([name, types]) => ({ name, types: [...types].sort() })) };
}

async function verify(root, evidence) {
  if (!evidence) return null;
  const actual = await hashFile(await resolveInside(root, evidence.path));
  if (actual.sha256 !== evidence.sha256 || actual.bytes !== evidence.bytes) throw new Error('ASSET_INTEGRITY_MISMATCH');
  return evidence;
}

export async function fileAssets(root, batchId, contractSha256) {
  const batch = await readJson(await resolveInside(root, `file-batches/${batchId}/batch.json`));
  const assets = [];
  for (const entry of batch.entries) {
    if (!entry.rawPath) continue;
    const raw = await verify(root, { path: entry.rawPath, ...entry.input });
    const parsed = entry.parsedPath ? await verify(root, { path: entry.parsedPath, ...entry.parsed }) : null;
    assets.push({ key: entry.relativePath, kind: 'FILE', state: parsed ? 'PARSED' : entry.state === 'FAILED' ? 'FAILED' : 'RAW_COMMITTED',
      schema: await observedSchema(root, parsed?.path), contractSha256: contractSha256 ?? digest('parser-v2'),
      rows: entry.rows ?? 0, bytes: raw.bytes, evidence: { raw, parsed, format: entry.format, batchId: entry.originalBatchId ?? batch.batchId,
        scalarEncoding: entry.scalarEncoding ?? null, errorCode: entry.errorCode ?? null } });
  }
  return assets;
}

export async function apiAssets(root, source, batchId) {
  const batchRoot = `api/${source}/${batchId}`;
  let batch = await readJson(await resolveInside(root, batchRoot + '/batch.json').catch(() => path.join(root, batchRoot, 'batch.json')), null);
  if (!batch) batch = await readJson(await resolveInside(root, batchRoot + '/batch.failed.json'));
  const assets = [];
  for (const page of batch.pages) {
    const raw = await verify(root, page.raw), parsed = await verify(root, page.normalized);
    assets.push({ key: `page-${page.page}`, kind: 'API', state: parsed ? 'PARSED' : 'RAW_COMMITTED',
      schema: await observedSchema(root, parsed?.path), contractSha256: batch.configSha256, rows: page.rows ?? 0, bytes: raw.bytes,
      evidence: { raw, parsed, format: 'API_RESPONSE', batchId: batch.batchId, scalarEncoding: batch.scalarEncoding } });
  }
  return assets;
}
