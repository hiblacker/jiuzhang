import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const failures=[];
let count=0;
async function walk(directory){
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  if(['.git','work','node_modules'].includes(entry.name)) continue;
  const full=path.join(directory,entry.name);
  if(entry.isDirectory()){await walk(full);continue;}
  if(!entry.name.endsWith('.md')) continue;
  count++;
  const text=await fs.readFile(full,'utf8');
  if(text.includes('\ufffd')) failures.push(`${full}: invalid replacement character`);
  for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
   const target=match[1].split('#')[0];
   if(!target || /^[a-z]+:\/\//i.test(target) || target.startsWith('mailto:')) continue;
   try{await fs.access(path.resolve(path.dirname(full),decodeURIComponent(target)));}
   catch{failures.push(`${full}: missing link ${target}`);}
  }
 }
}
await walk(root);
const snap=JSON.parse(await fs.readFile('docs/research/github-snapshot-2026-09-10.json','utf8'));
const sources=JSON.parse(await fs.readFile('docs/research/primary-sources-2026-09-10.json','utf8'));
if(snap.repositories.length!==13) failures.push('Expected 13 repository records');
for(const r of snap.repositories){
 if(r.errors.length) failures.push(`${r.requested_repository}: API errors ${r.errors.join(', ')}`);
 if(!r.default_branch_commit_at_or_before_cutoff) failures.push(`${r.repository}: missing commit evidence`);
 if(!sources.sources.some(s=>s.repository===r.repository && s.readme_url && s.license_url)) failures.push(`${r.repository}: missing primary-source evidence`);
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`PASS: ${count} Markdown files; local links and 13 GitHub evidence records valid.`);
