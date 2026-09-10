import fs from 'node:fs/promises';
const date = process.argv[2] || '2026-09-10';
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Expected YYYY-MM-DD');
const snapshot = JSON.parse(await fs.readFile(`docs/research/github-snapshot-${date}.json`, 'utf8'));
const sources = [];
for (const repo of snapshot.repositories) {
  if (!repo.repository || !repo.default_branch_commit_at_or_before_cutoff) continue;
  const sha = repo.default_branch_commit_at_or_before_cutoff.sha;
  const base = `https://raw.githubusercontent.com/${repo.repository}/${sha}/`;
  const entry = {repository: repo.repository, sha};
  for (const filename of ['README.md', 'README.rst']) {
    let url = base + filename;
    let response = await fetch(url, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) continue;
    let text = await response.text();
    // Git raw may return the relative target of a README symlink.
    const target = text.trim();
    if (/^[a-zA-Z0-9_./-]+README\.(md|rst)$/.test(target) && !target.includes('..')) {
      url = base + target;
      response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`README target failed: ${url}`);
      text = await response.text();
    }
    entry.readme_url = url;
    // Keep downloaded README bodies as ignored scratch only, not redistributed evidence.
    await fs.mkdir('work/research', {recursive: true});
    await fs.writeFile(`work/research/${repo.repository.replaceAll('/', '--')}-README.txt`, text);
    break;
  }
  for (const filename of ['LICENSE', 'LICENSE.txt', 'LICENSE.md']) {
    const url = base + filename;
    const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) continue;
    const text = await response.text();
    entry.license_url = url;
    entry.license_heading = text.split('\n').map(x=>x.trim()).find(Boolean);
    break;
  }
  sources.push(entry);
  console.log(`${entry.repository}: README=${!!entry.readme_url}, LICENSE=${!!entry.license_url}`);
}
await fs.writeFile(`docs/research/primary-sources-${date}.json`, JSON.stringify({observed_at: new Date().toISOString(), sources}, null, 2)+'\n');
