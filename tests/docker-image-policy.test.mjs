import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skippedDirectories = new Set(['.git', 'node_modules', 'secrets', 'target', 'work']);
const digestMarker = ['@', 'sha256:'].join('');
const bareImageId = new RegExp(['sha256', ':[0-9a-f]{64}'].join(''), 'i');

async function runtimeFiles(directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await runtimeFiles(full));
    else if (/^Dockerfile(?:\.|$)/.test(entry.name) || /\.(?:ya?ml|mjs|cjs|js|sh|ps1)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function explicitVersion(reference) {
  const value = reference.replace(/^['"]|['"]$/g, '');
  const lastSlash = value.lastIndexOf('/');
  const lastColon = value.lastIndexOf(':');
  const version = value.slice(lastColon + 1);
  return !value.includes('@')
    && lastColon > lastSlash
    && version !== 'latest'
    && !(/^(?:bydw|jiuzhang)\//.test(value) && /-dev$/.test(version));
}

function imageReferences(file, source) {
  const references = [];
  for (const match of source.matchAll(/^\s*image:\s*([^\s#]+)/gm)) references.push(match[1]);
  for (const match of source.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/gmi)) references.push(match[1]);
  for (const match of source.matchAll(/\bIMAGE\s*=\s*(['"][^'"]+['"])/g)) references.push(match[1]);
  if (path.basename(file) === 'run.mjs') {
    for (const match of source.matchAll(/\bIMAGES\s*=\s*\[([\s\S]*?)\];/g)) {
      for (const value of match[1].matchAll(/['"]([^'"]+)['"]/g)) references.push(value[1]);
    }
  }
  return references;
}

test('Docker runtime references use explicit versions, never digests or image IDs', async () => {
  const failures = [];
  for (const file of await runtimeFiles()) {
    const source = await readFile(file, 'utf8');
    if (source.includes(digestMarker)) failures.push(`${path.relative(root, file)} contains a digest image reference`);
    for (const line of source.split(/\r?\n/)) {
      if (/\bdocker\b.*\b(?:run|pull)\b/i.test(line) && bareImageId.test(line)) {
        failures.push(`${path.relative(root, file)} runs a bare image ID`);
      }
    }
    for (const reference of imageReferences(file, source)) {
      if (!explicitVersion(reference)) failures.push(`${path.relative(root, file)} has non-versioned image ${reference}`);
    }
  }
  assert.deepEqual(failures, []);
});
