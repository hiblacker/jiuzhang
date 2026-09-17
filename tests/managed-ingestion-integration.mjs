import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runOnce,validateRegistry } from '../apps/ingestion-worker/lake-runtime.mjs';

const base=process.env.MODEL_TEST_API,admin=process.env.MODEL_TEST_ADMIN,worker=process.env.CONTROL_API_WORKER_TOKEN;
assert.ok(base?.startsWith('http://127.0.0.1:')&&admin&&worker);
const id='managed_'+randomUUID().replaceAll('-',''), root=await mkdtemp(path.join(os.tmpdir(),'managed-integration-'));
async function request(route,body,expected=200,token=admin){const response=await fetch(base+'/api/v1/'+route,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-worker-instance':id},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"ok":true,"rows":[{"id":"001","value":7}]}');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const project=await request('warehouse/projects',{code:id,name:'Managed ingestion integration'});
  const system=await request(`warehouse/projects/${project.id}/systems`,{code:id,name:'Synthetic ERP',businessOwner:'Test',technicalOwner:'Test'});
  const instance=await request(`warehouse/projects/${project.id}/systems/${system.id}/instances`,{code:'test',name:'Test',environment:'TEST'});
  await request('warehouse/environments',{code:id,name:'Test worker',workerIds:[id],maxParallel:2});
  const inbox=path.join(root,'inbox');await mkdir(inbox);await writeFile(path.join(inbox,'orders.csv'),'id,value\n001,7\n');await writeFile(path.join(inbox,'orders.csv.done'),'');
  await writeFile(path.join(inbox,'orders.json'),'[{"id":"001","value":7}]');
  const generated=spawnSync(process.env.LAKE_PYTHON||'python3',['-c',
    "from pathlib import Path; import sys,openpyxl,pyarrow as pa,pyarrow.parquet as pq; p=Path(sys.argv[1]); w=openpyxl.Workbook(); s=w.active; s.append(['id','value']); s.append(['001',7]); w.save(p/'orders.xlsx'); pq.write_table(pa.table({'id':['001'],'value':[7]}),p/'orders.parquet')",inbox],{encoding:'utf8'});
  assert.equal(generated.status,0,'Synthetic format fixture generation');
  for(const format of ['json','xlsx','parquet'])await writeFile(path.join(inbox,`orders.${format}.done`),'');
  const apiConfig=path.join(root,'api.json');await writeFile(apiConfig,JSON.stringify({version:1,base_url:`http://127.0.0.1:${server.address().port}`,allowed_hosts:['127.0.0.1'],requests_per_second:100}));
  const registry=validateRegistry({version:2,environment:id,lakeRoot:path.join(root,'lake'),resources:{
    [id+'_files']:{kind:'FILE_SCAN',resourceGroup:id+'_files',inboxRoot:inbox,parserPython:process.env.LAKE_PYTHON},
    [id+'_api']:{kind:'REST_PULL',resourceGroup:id+'_api',config:apiConfig,allowedPaths:['/orders']},
  }});
  const options={controlApi:base,token:worker,instance:id};
  const sources=[],copies=[];
  for(const type of ['files','api']){
    const kind=type==='files'?'FILE_SCAN':'REST_PULL';
    const resource=await request('warehouse/resources',{code:id+'_'+type,name:type,kind,environment:id,resourceGroup:id+'_'+type,maxBytes:1048576,maxParallel:1,requestsPerSecond:100});
    await request(`warehouse/resources/${resource.id}/grant`,{projectId:project.id});
    const connection=await request(`warehouse/projects/${project.id}/instances/${instance.id}/connections`,{code:type,name:type,resourceId:resource.id,config:{}});
    const config=type==='files'?{relativeDirectory:'',datePartitioned:false,delivery:{version:1,mode:'DAILY_SET',readiness:'DONE',expectedFiles:['orders.csv','orders.json','orders.xlsx','orders.parquet'],allowEmpty:false}}:{path:'/orders',pagination:{mode:'none',records_path:'rows'},success:{path:'ok',equals:true}};
    const channel=await request(`warehouse/projects/${project.id}/connections/${connection.id}/channels`,{code:id+'_'+type,name:type,config});sources.push(channel.source_id);
    const route=`warehouse/projects/${project.id}/channels/${channel.source_id}`;
    const probe=await request(route+'/probes',{requestKey:'first'},202);
    assert.equal((await runOnce(options,registry)).state,'COMPLETE');
    assert.equal((await request(route+'/probes'))[0].state,'COMPLETE');
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
    const plan=await request(route+'/activate',{probeId:probe.id,expectedPlanVersion:0,timezone:'Asia/Shanghai',triggerTime:'00:00',startDate:day,historicalRead:type==='files',timeoutSeconds:300});
    await request(route+'/trigger',{day,reason:'Synthetic full workflow'});
    assert.equal((await runOnce(options,registry)).state,'COMPLETE');
    const attempts=await request(`lake/executions?planId=${plan.id}`);assert.equal(attempts[0].state,'COMPLETE');
    const external=await request(`warehouse/projects/${project.id}/assets`);assert.ok(external.some(asset=>asset.source_code===channel.code&&asset.row_count===1));
    assert.equal(external.filter(asset=>asset.source_code===channel.code).length,type==='files'?4:1);
    // The same registry object sees another channel without adding a process profile.
    const copied=await request(`warehouse/projects/${project.id}/connections/${connection.id}/channels`,{code:id+'_'+type+'_second',name:'Second independent channel',config});
    assert.notEqual(copied.source_id,channel.source_id);copies.push(copied.source_id);
    await request(`lake/plans/${plan.id}/state`,{state:'PAUSED'});
  }
  // Atomic resource and worker-pool reservations: two aliases on one file connection cannot overlap.
  const filteredRuns=await request(`warehouse/catalog/projects/${project.id}/runs?systemCode=${id}&instanceCode=test&connectionCode=files&sourceCode=${id}_files&state=COMPLETE`);
  assert.equal(filteredRuns.total,1);assert.equal(filteredRuns.items[0].source_code,id+'_files');
  assert.equal((await request(`warehouse/catalog/projects/${project.id}/runs?systemCode=unrelated&state=COMPLETE`)).total,0);
  await request(`warehouse/catalog/projects/${project.id}/runs?systemCode=${encodeURIComponent("' OR TRUE --")}`,undefined,400);
  for(const source of [sources[0],copies[0],sources[1]])await request(`warehouse/projects/${project.id}/channels/${source}/probes`,{requestKey:'quota-check'},202);
  const claims=await Promise.all(Array.from({length:3},()=>request('lake/probes/claim',{environment:id},200,worker)));
  const active=claims.filter(c=>c.state==='RUNNING');assert.equal(active.length,2);assert.equal(claims.filter(c=>c.state==='IDLE').length,1);
  assert.deepEqual(active.map(c=>JSON.parse(c.configurationJson).kind).sort(),['FILE_SCAN','REST_PULL']);
  for(const claim of active)await request(`lake/probes/${claim.id}/finish`,{leaseToken:claim.leaseToken,state:'FAILED',errorCode:'SYNTHETIC_QUOTA_RELEASE',result:{}},200,worker);
  const remaining=await request('lake/probes/claim',{environment:id},200,worker);assert.equal(remaining.state,'RUNNING');assert.equal(JSON.parse(remaining.configurationJson).sourceId,copies[0]);
  await request(`lake/probes/${remaining.id}/finish`,{leaseToken:remaining.leaseToken,state:'FAILED',errorCode:'SYNTHETIC_QUOTA_RELEASE',result:{}},200,worker);
  assert.equal((await request('lake/probes/claim',{environment:id},200,worker)).state,'IDLE');
  const other=await request('warehouse/projects',{code:id+'_other',name:'Unrelated'});
  await request(`warehouse/projects/${other.id}/channels/${sources[0]}`,undefined,403);
  const delivery=`warehouse/projects/${project.id}/instances/${instance.id}/delivery`;
  const businessDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
  await request(delivery+'/agreements',{expectedVersion:0,effectiveFrom:businessDate,timezone:'Asia/Shanghai',reason:'Daily completeness contract',channels:sources.map(sourceId=>({sourceId,required:true,deadline:'23:59'}))});
  await request(delivery+'/check',{day:businessDate});
  const complete=await request(delivery+'?day='+businessDate);assert.equal(complete.state,'COMPLETE');assert.equal(complete.required,2);
  await request(delivery+'/agreements',{expectedVersion:1,effectiveFrom:businessDate,timezone:'Asia/Shanghai',reason:'Explicitly revise future checks',channels:[]});
  await request(delivery+'/check',{day:businessDate});
  assert.equal((await request(delivery+'?day='+businessDate)).required,2,'Frozen denominator must not change');
  const operations=`warehouse/projects/${project.id}/ingestion-operations`;
  const preview=await request(operations+'/preview',{action:'PAUSE',reason:'Synthetic pause review',targets:[{type:'system',id:system.id,expectedVersion:system.revision},{type:'channel',id:9223372036854,expectedVersion:1}]});
  const paused=await request(operations+`/${preview.id}/execute`,{});assert.equal(paused.items[0].success,true);assert.equal(paused.items[1].eligible,false);
  assert.deepEqual(await request(operations+`/${preview.id}/execute`,{}),paused,'Bulk replay must be idempotent');
  await request(`warehouse/projects/${project.id}/channels/${sources[0]}/trigger`,{day:businessDate,revision:true,reason:'Paused system'},409);
  const stale=await request(operations+'/preview',{action:'RESUME',reason:'Stale preview',targets:[{type:'system',id:system.id,expectedVersion:system.revision}]});assert.equal(stale.items[0].eligible,false);
  const resume=await request(operations+'/preview',{action:'RESUME',reason:'Resume review',targets:[{type:'system',id:system.id,expectedVersion:system.revision+1}]});assert.equal((await request(operations+`/${resume.id}/execute`,{})).items[0].success,true);
  const retire=await request(operations+'/preview',{action:'RETIRE',reason:'Synthetic retirement',targets:[{type:'system',id:system.id,expectedVersion:system.revision+2}]});assert.equal((await request(operations+`/${retire.id}/execute`,{})).items[0].success,true);
  assert.equal((await request(`warehouse/projects/${project.id}/assets`)).length,5,'Retirement preserves existing assets');
  console.log(JSON.stringify({state:'COMPLETE',managedSources:sources.length,profilesEdited:false}));
}finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
