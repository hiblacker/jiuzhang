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
