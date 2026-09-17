import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm,copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { run } from '../tools/rest-ingest.mjs';

test('independent API sources progress concurrently and legacy replay preserves originals',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'source-ledger-'));let release,entered,requests=0;
  const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const server=http.createServer(async(req,res)=>{requests++;if(req.url==='/slow'){entered();await held;}res.setHeader('Content-Type','application/json');res.end('[{"id":1}]');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const code of ['slow','fast'])await writeFile(path.join(root,code+'.json'),JSON.stringify({version:1,source_code:code,base_url:`http://127.0.0.1:${server.address().port}`,path:'/'+code,pagination:{mode:'none'}}));
    const first=run({config:path.join(root,'slow.json'),lakeRoot:root,window:'2026-09-16',batchId:'slow-one'});
    await started;const second=await run({config:path.join(root,'fast.json'),lakeRoot:root,window:'2026-09-16',batchId:'fast-one'});assert.equal(second.state,'COMPLETE');release();assert.equal((await first).state,'COMPLETE');
    const perSource=path.join(root,'source-ledgers/api/fast.json'),legacy=path.join(root,'api-ledger.json');
    await copyFile(perSource,legacy);const before=await readFile(legacy);await rm(perSource);
    const count=requests;const replay=await run({config:path.join(root,'fast.json'),lakeRoot:root,window:'2026-09-16',batchId:'fast-replay'});
    assert.equal(replay.state,'COMPLETE');assert.equal(requests,count);assert.deepEqual(await readFile(legacy),before);
  }finally{release();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
