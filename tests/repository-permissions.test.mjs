// Container images copy this repository, and several runtime files are read by unprivileged
// users (the ingestion and model workers run as uid 1000). A file that the packaging step can
// read but the runtime user cannot produces a confusing EACCES at execution time, so the
// repository itself must stay world-readable for the paths that end up in images.
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = ['apps', 'tools', 'deploy', 'migrations', 'models', 'tests'];
const SKIP = new Set(['node_modules', 'target', 'dist', '.git', 'artifacts', '__pycache__']);

async function walk(relative, found = []) {
  const directory = path.join(ROOT, relative);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) await walk(child, found);
    else if (entry.isFile()) found.push(child);
  }
  return found;
}

test('files shipped into images are readable by the container runtime user', async () => {
  const unreadable = [];
  for (const directory of SHIPPED) {
    for (const file of await walk(directory)) {
      const info = await stat(path.join(ROOT, file));
      // 0o044 = readable by group and others: enough for the uid 1000 runtime users.
      if ((info.mode & 0o044) !== 0o044) unreadable.push(`${file} (mode ${(info.mode & 0o777).toString(8)})`);
    }
  }
  assert.deepEqual(unreadable, [], `files not readable by the runtime user:\n${unreadable.join('\n')}`);
});

test('the worker entry points the container executes are present', async () => {
  for (const file of ['tools/lake-ingest.mjs', 'tools/lake-seatunnel.mjs', 'tools/datasource-test.mjs',
    'apps/ingestion-worker/lake-runtime.mjs', 'apps/model-worker/worker.py']) {
    const info = await stat(path.join(ROOT, file));
    assert.ok(info.isFile(), `${file} missing`);
    assert.ok((info.mode & 0o044) === 0o044, `${file} is not readable by the runtime user`);
  }
});
