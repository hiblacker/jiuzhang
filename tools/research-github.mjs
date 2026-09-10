import fs from 'node:fs/promises';
const repos = ['apache/seatunnel','apache/dolphinscheduler','apache/airflow','dagster-io/dagster','dbt-labs/dbt-core','SQLMesh/sqlmesh','datahub-project/datahub','open-metadata/OpenMetadata','apache/doris','apache/hop','apache/incubator-devlake','great-expectations/great_expectations','airbytehq/airbyte'];
const asOf = process.argv[2] || '2026-09-10';
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('Expected YYYY-MM-DD');
const cutoff = `${asOf}T23:59:59Z`;
const headers = {'User-Agent':'by-data-warehouse-public-research','Accept':'application/vnd.github+json'};
async function get(path) {
  const url = `https://api.github.com${path}`;
  const response = await fetch(url, {headers, signal: AbortSignal.timeout(45000)});
  if (!response.ok) return {error: `${response.status} ${response.statusText}`, url};
  return {body: await response.json(), url};
}
const rows=[];
for(const repo of repos) {
  const [meta, commits, releases] = await Promise.all([
    get(`/repos/${repo}`),
    get(`/repos/${repo}/commits?per_page=1&until=${encodeURIComponent(cutoff)}`),
    get(`/repos/${repo}/releases?per_page=10`)
  ]);
  const m=meta.body, c=commits.body?.[0];
  const candidates = Array.isArray(releases.body) ? releases.body.filter(r=>!r.draft && !r.prerelease && r.published_at<=cutoff).sort((a,b)=>b.published_at.localeCompare(a.published_at)) : [];
  const r=candidates[0];
  const result={requested_repository:repo,repository:m?.full_name,url:m?.html_url,description:m?.description,archived:m?.archived,stars_observed:m?.stargazers_count,default_branch:m?.default_branch,license_spdx:m?.license?.spdx_id,license_api:m?.license?.url,pushed_at_observed:m?.pushed_at,default_branch_commit_at_or_before_cutoff:c?{sha:c.sha,date:c.commit.committer.date,url:c.html_url}:null,observed_github_release:r?{tag:r.tag_name,date:r.published_at,url:r.html_url}:null,release_search_note:'First 10 GitHub releases only; selected using published_at and API prerelease/draft flags. Tags may still contain beta/rc. Not a verified latest stable distribution.',sources:[meta.url,commits.url,releases.url],errors:[meta.error,commits.error,releases.error].filter(Boolean)};
  rows.push(result);
  console.log(JSON.stringify(result));
}
await fs.mkdir('docs/research',{recursive:true});
await fs.writeFile(`docs/research/github-snapshot-${asOf}.json`,JSON.stringify({as_of_date:asOf,cutoff_utc:cutoff,observed_at:new Date().toISOString(),method:'Public GitHub REST API without authentication. Star/pushed/archive/license fields are live observations, not historical reconstruction. Default-branch commit filtered by cutoff; GitHub release selected from first 10 using API flags only; not verified stable.',repositories:rows},null,2)+'\n');
