#!/usr/bin/env python3
"""Optional real OceanBase MySQL-mode acceptance; never counts a missing endpoint as verified."""
from importlib import import_module
from pathlib import Path
import json
import os
import subprocess
import tempfile
import time
import uuid
import zipfile


def main():
    local=import_module('local-stack')
    os.chdir(local.ROOT)
    if (local.ROOT/'.env').exists(): os.environ.update(local.environment())
    required=['HOST','PORT','DATABASE','USER','PASSWORD']
    missing=[key for key in required if not os.environ.get('OCEANBASE_'+key)]
    if missing:
        local.LOCAL.mkdir(exist_ok=True)
        (local.LOCAL/'oceanbase-test.json').write_text(json.dumps({'status':'unverified','reason':'OCEANBASE environment not configured'}))
        print('未验证：未配置 OCEANBASE_'+', OCEANBASE_'.join(missing)+'；跳过 OceanBase 真实引擎验收。')
        return
    with tempfile.TemporaryDirectory(prefix='oceanbase-',dir=local.LOCAL) as directory:
        with zipfile.ZipFile('apps/api/target/api-0.1.0-SNAPSHOT.jar') as archive:
            for item in archive.infolist():
                if item.filename.startswith('BOOT-INF/lib/') and item.filename.endswith('.jar'):
                    (Path(directory)/Path(item.filename).name).write_bytes(archive.read(item))
        classpath=str(local.ROOT/'modules/platform/target/classes')+os.pathsep+directory+'/*'
        subprocess.run(['java','-cp',classpath,'tools/java/OceanBaseAcceptance.java'],check=True,timeout=180)
    Client=import_module('test-identity').Client
    client=Client()
    client.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    suffix=uuid.uuid4().hex[:10]
    body=import_module('test-sources').source_input()
    body.update(name='oceanbase_'+suffix,type='OceanBase')
    body['settings'].update(host=os.environ['OCEANBASE_HOST'],port=int(os.environ['OCEANBASE_PORT']),database=os.environ['OCEANBASE_DATABASE'],tls=os.environ.get('OCEANBASE_TLS','true').lower()=='true')
    body['credentials']={'username':os.environ['OCEANBASE_USER'],'password':os.environ['OCEANBASE_PASSWORD']}
    client.call('POST','/sources',{k:v for k,v in body.items() if k!='credentials'},expected=422)
    client.call('POST','/sources/test',body)
    bad={**body,'credentials':{**body['credentials'],'password':'incorrect-acceptance-password'}}
    error=client.call('POST','/sources/test',bad,expected=422)[0]
    assert os.environ['OCEANBASE_PASSWORD'] not in json.dumps(error)
    source=client.call('POST','/sources',body,expected=201)[0]['data']
    assert source['type']=='OceanBase' and source['credentialConfigured'] and source['connectionUsername']==os.environ['OCEANBASE_USER']
    assert 'credentials' not in source and os.environ['OCEANBASE_PASSWORD'] not in json.dumps(source)
    sid=source['id']
    client.call('PATCH','/sources/'+sid,{'description':'retained credential'})
    client.call('POST','/sources/'+sid+'/test')
    objects=client.call('GET','/sources/'+sid+'/objects')[0]['data']
    table=os.environ.get('OCEANBASE_TEST_TABLE','orders')
    obj=next(row for row in objects if row['name']==table)
    assert obj['rowCountKnown'] is False
    preview=client.call('POST','/sources/'+sid+'/preview',{'objectId':obj['id']})[0]['data']
    assert preview['rows']
    fields=[{**field,'type':'integer' if field['name']=='id' else 'decimal(20,4)'} for field in obj['fields'] if field['name'] in ('id','amount')]
    definition={'sourceId':sid,'objectId':obj['id'],'upstreamDatasetId':'','mode':'visual','deliveryMode':'warehouse','sql':'','fields':fields,'nodes':[{'id':'input','type':'input','label':'input','x':0,'y':0,'config':''}],'edges':[],'cleaning':[],'qualityRuleIds':[],'maskPolicyIds':[],
        'schedule':{'mode':'manual','cron':'0 9 * * *','intervalMinutes':1,'timezone':'Asia/Shanghai','retries':0,'timeoutSeconds':300,'concurrency':1,'dependencies':[]},'output':{'table':'ob_'+suffix,'layer':'DWD','keys':[],'writeMode':'replace'}}
    dataset={'name':'oceanbase_'+suffix,'description':'synthetic acceptance','owner':'test','tags':[],'definition':definition}
    did=client.call('POST','/datasets',dataset,expected=201)[0]['data']['id']
    key=lambda:{'Idempotency-Key':str(uuid.uuid4())}
    client.call('POST','/datasets/'+did+'/publish',extra_headers=key())
    def run(dataset_id):
        rid=client.call('POST','/datasets/'+dataset_id+'/runs',{},expected=201,extra_headers=key())[0]['data']['id']
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            state=client.call('GET','/runs/'+rid)[0]['data']
            if state['status'] in ('succeeded','failed','blocked','canceled'):break
            time.sleep(.2)
        assert state['status']=='succeeded',state['errorCode']
        return state
    state=run(did)
    warehouse=client.call('GET','/warehouse/tables/'+did)[0]['data']
    assert warehouse['rowCount']==state['rowCount'] and int(state['rowCount'])>0
    sql_definition={**definition,'mode':'sql','objectId':'','sql':'SELECT id, amount FROM `'+table+'`','deliveryMode':'direct','output':{**definition['output'],'table':''}}
    sql_body={**dataset,'name':'ob_direct_'+suffix,'definition':sql_definition}
    assert client.call('POST','/datasets/preview',sql_body)[0]['data']['rows']
    direct=client.call('POST','/datasets',sql_body,expected=201)[0]['data']['id']
    client.call('POST','/datasets/'+direct+'/publish',extra_headers=key())
    assert client.call('POST','/datasets/'+direct+'/query',{'limit':100})[0]['data']['rows']
    sql_body={**sql_body,'name':'ob_sql_'+suffix,'definition':{**sql_definition,'deliveryMode':'warehouse','output':{**definition['output'],'table':'ob_sql_'+suffix}}}
    sql_id=client.call('POST','/datasets',sql_body,expected=201)[0]['data']['id']
    client.call('POST','/datasets/'+sql_id+'/publish',extra_headers=key())
    assert run(sql_id)['rowCount']==state['rowCount']
    report={'status':'passed','sourceId':sid,'datasetId':did,'directDatasetId':direct,'sqlWarehouseId':sql_id,'rowCount':state['rowCount'],'connector':json.loads(Path('.local/oceanbase-connector-test.json').read_text())}
    Path('.local/oceanbase-test.json').write_text(json.dumps(report,indent=2))
    print('PASS real OceanBase API: credentials/type/discover/preview, direct SQL, table+SQL Worker scans and Doris snapshot publication')


if __name__=='__main__': main()
