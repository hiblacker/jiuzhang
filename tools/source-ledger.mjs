import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readJson } from './lake-runtime.mjs';

/** Adopt only this source's historical keys; original shared ledgers remain unchanged. */
export async function sourceLedger(root, kind, source) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(source)) throw new Error('INVALID_SOURCE_CODE');
  const definitions = {
    mysql: ['daily-ledger.json', 'windows', 2],
    file: ['file-ledger.json', 'deliveries', 1],
    api: ['api-ledger.json', 'windows', 2],
  };
  const definition = definitions[kind];
  if (!definition) throw new Error('INVALID_LEDGER_KIND');
  const [legacyName, field, version] = definition;
  const directory = path.join(root, 'source-ledgers', kind);
  const file = path.join(directory, `${source}.json`);
  const current = await readJson(file, null);
  if (current) return { file, ledger: current };
  const previous = await readJson(path.join(root, legacyName), { [field]: {} });
  const entries = Object.fromEntries(Object.entries(previous[field] ?? {}).filter(([key]) => key.startsWith(`${source}|`)
    // Ancient date-only MySQL keys are verified against their source manifest by the caller.
    || (kind === 'mysql' && /^\d{4}-\d{2}-\d{2}$/u.test(key))));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return { file, ledger: { version, [field]: entries } };
}
