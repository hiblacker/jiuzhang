import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest } from '../tools/lake-runtime.mjs';
import { managedProfile, probeManaged, validateManagedRegistry } from '../apps/ingestion-worker/managed-runtime.mjs';
import { validateRegistry } from '../apps/ingestion-worker/lake-runtime.mjs';

test('managed file resources enforce digest, environment, real directory boundary and fixed parser contract', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'managed-resource-'));
  try {
    const inbox=path.join(root,'inbox'),outside=path.join(root,'outside');await mkdir(inbox);await mkdir(outside);
    await writeFile(path.join(inbox,'orders.csv'),'id\n001\n');await symlink(outside,path.join(inbox,'escape'));
    const registry={version:2,environment:'local',lakeRoot:path.join(root,'lake'),resources:{files:{kind:'FILE_SCAN',resourceGroup:'shared-files',inboxRoot:inbox}}};
    assert.equal(validateRegistry(registry).version,2);
    const config={protocol:2,sourceCode:'orders',environment:'local',resourceRef:'files',resourceGroup:'shared-files',kind:'FILE_SCAN',channelVersion:1,maxBytes:1048576,connection:{},channel:{relativeDirectory:'',delivery:{version:1,mode:'DAILY_SET',expectedFiles:['orders.csv']}}};
    const task=()=>{const configurationJson=JSON.stringify(config);return {configurationJson,configurationSha256:digest(configurationJson)}};
    const result=await probeManaged(registry,task());assert.equal(result.fileCount,1);assert.equal(result.files[0].name,'orders.csv');assert.ok(!JSON.stringify(result).includes('001'));
    await assert.rejects(()=>managedProfile(registry,{...task(),configurationSha256:'a'.repeat(64)}),/DIGEST_MISMATCH/);
    config.channel.relativeDirectory='escape';await assert.rejects(()=>managedProfile(registry,task()),/OUTSIDE_ROOT/);
    config.channel.relativeDirectory='../outside';await assert.rejects(()=>managedProfile(registry,task()),/OUTSIDE_RESOURCE/);
    config.channel.relativeDirectory='';config.environment='production';await assert.rejects(()=>managedProfile(registry,task()),/SCOPE_MISMATCH/);
    assert.throws(()=>validateManagedRegistry({...registry,resources:{files:{kind:'SHELL',resourceGroup:'shared-files'}}}),/INVALID_MANAGED_RESOURCE/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('registered-SQL profile needs no local resource entry and keeps the platform snapshot limit', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'managed-sql-'));
  try {
    // A SQL datasource is approved by an administrator in the control plane; this local registry
    // deliberately contains no entry for it.
    const registry={version:2,environment:'local',lakeRoot:path.join(root,'lake'),resources:{}};
    const config={protocol:2,sourceCode:'erp-orders',environment:'local',kind:'MYSQL_SNAPSHOT',
      resourceRef:'erp-readonly',resourceGroup:'erp',channelVersion:3,maxBytes:268435456,sourceMode:'REGISTERED_SQL',
      datasourceType:'MYSQL',credentialRef:'erp-readonly',seatunnelUrl:'http://seatunnel:5801',
      statementTimeoutMs:60000,sqlVersionId:7,sqlText:'SELECT CAST(`订单编号` AS CHAR) AS order_no FROM `erp`.`biz_order`',
      sqlSha256:'b'.repeat(64),extractionMode:'FULL',watermarkColumn:null,
      resultColumns:[{name:'order_no',type:'VARCHAR'}],uniqueKey:['order_no']};
    const task=()=>{const configurationJson=JSON.stringify(config);return {configurationJson,configurationSha256:digest(configurationJson),kind:'MYSQL_SNAPSHOT',source_code:'erp-orders'}};
    const profile=await managedProfile(registry,task());
    assert.equal(profile.sourceMode,'REGISTERED_SQL');
    assert.equal(profile.maxSnapshotBytes,268435456);
    assert.equal(profile.datasource.credentialRef,'erp-readonly');
    assert.equal(profile.sql.versionId,7);
    await assert.rejects(()=>managedProfile(registry,{...task(),configurationSha256:'c'.repeat(64)}),/DIGEST_MISMATCH/);
    config.sqlSha256='not-a-digest';await assert.rejects(()=>managedProfile(registry,task()),/INVALID_SQL_DIGEST/);
    config.sqlSha256='b'.repeat(64);config.datasourceType='POSTGRESQL';await assert.rejects(()=>managedProfile(registry,task()),/DATASOURCE_TYPE_NOT_SUPPORTED/);
    config.datasourceType='MYSQL';config.maxBytes=undefined;await assert.rejects(()=>managedProfile(registry,task()),/INVALID_MANAGED_RESOURCE_LIMIT/);
  } finally {await rm(root,{recursive:true,force:true});}
});
