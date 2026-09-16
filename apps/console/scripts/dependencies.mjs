import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
const accepted = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', '(MIT OR Apache-2.0)', '(MIT AND CC-BY-3.0)']);
const packages = [];
for (const [location, item] of Object.entries(lock.packages)) {
  if (!location) continue;
  const name = item.name || location.split('node_modules/').at(-1);
  const buildOnlyMpl = name.startsWith('lightningcss') && item.dev && item.license === 'MPL-2.0';
  if (!accepted.has(item.license) && !buildOnlyMpl) throw new Error(`LICENSE_REVIEW_REQUIRED: ${name}: ${item.license}`);
  if (!item.integrity?.startsWith('sha512-') || !/^https:\/\/registry.npmmirror.com\//.test(item.resolved)) throw new Error(`INVALID_LOCK: ${name}`);
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${item.version}`);
  if (!response.ok) throw new Error(`OFFICIAL_METADATA_UNAVAILABLE: ${name}`);
  const metadata = await response.json();
  if (metadata.dist.integrity !== item.integrity || metadata.license !== item.license) throw new Error(`METADATA_MISMATCH: ${name}`);
  packages.push({ name, version: item.version, license: item.license, integrity: item.integrity, development: !!item.dev, optional: !!item.optional, hasInstallScript: !!item.hasInstallScript, repository: metadata.repository?.url ?? '', tarball: item.resolved });
}
const report = { generatedAt: new Date().toISOString(), registry: 'https://registry.npmmirror.com', verifiedAgainst: 'https://registry.npmjs.org', installationScripts: 'disabled', scope: 'Frontend development and internal verification; not a distribution approval', licenseNotes: { 'MPL-2.0': 'Lightning CSS and its platform binaries are unmodified build-only dependencies. They are not shipped in the static console. Retain notices and provide covered source if distributing the build environment; no MPL-covered file is modified here.' }, packages };
await writeFile(new URL('dependency-review.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: ${packages.length} exact dependencies; official integrity and license declarations match.`);
