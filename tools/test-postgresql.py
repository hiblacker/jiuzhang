#!/usr/bin/env python3
"""Real PostgreSQL source acceptance against the isolated local 17.6 fixture."""
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
    subprocess.run(['python3','tools/init-postgresql-source.py','--reset'],check=True)
    os.environ.update(local.environment())
    with tempfile.TemporaryDirectory(prefix='postgresql-',dir=local.LOCAL) as directory:
        with zipfile.ZipFile('apps/api/target/api-0.1.0-SNAPSHOT.jar') as archive:
            for item in archive.infolist():
                if item.filename.startswith('BOOT-INF/lib/') and item.filename.endswith('.jar'):
                    (Path(directory)/Path(item.filename).name).write_bytes(archive.read(item))
        classpath=str(local.ROOT/'modules/platform/target/classes')+os.pathsep+directory+'/*'
        subprocess.run(['java','-cp',classpath,'tools/java/PostgreSqlAcceptance.java'],check=True,timeout=120)
    client=import_module('test-identity').Client()
    client.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    suffix=uuid.uuid4().hex[:10]
    body=import_module('test-sources').source_input()
    body.update(name='postgresql_'+suffix,type='PostgreSQL')
    body['settings'].update(host='localhost',port=15433,database='demo_retail',schema='Retail',tls=True)
    body['credentials']={'username':'jiuzhang_reader','password':os.environ['POSTGRESQL_SOURCE_PASSWORD']}
    client.call('POST','/sources',{k:v for k,v in body.items() if k!='credentials'},expected=422)
    client.call('POST','/sources/test',body)
    bad={**body,'credentials':{**body['credentials'],'password':'incorrect-acceptance-password'}}
    error=client.call('POST','/sources/test',bad,expected=422)[0]
    assert os.environ['POSTGRESQL_SOURCE_PASSWORD'] not in json.dumps(error)
    source=client.call('POST','/sources',body,expected=201)[0]['data']
    assert source['type']=='PostgreSQL' and source['credentialConfigured'] and source['settings']['schema']=='Retail'
    assert 'credentials' not in source and os.environ['POSTGRESQL_SOURCE_PASSWORD'] not in json.dumps(source)
    sid=source['id']
    client.call('PATCH','/sources/'+sid,{'description':'retained credential and schema'})
    client.call('POST','/sources/'+sid+'/test')
    objects=client.call('GET','/sources/'+sid+'/objects')[0]['data']
    obj=next(row for row in objects if row['name']=='Orders')
    assert all(row['rowCountKnown'] is False for row in objects)
    preview=client.call('POST','/sources/'+sid+'/preview',{'objectId':obj['id']})[0]['data']
    assert len(preview['rows'])==100
    types={'id':'integer','amount':'decimal(20,4)','active':'boolean','happened_at':'datetime','local_at':'datetime','event_date':'date'}
    fields=[{**field,'type':types.get(field['name'],'string')} for field in obj['fields']]
    definition={'sourceId':sid,'objectId':obj['id'],'upstreamDatasetId':'','mode':'visual','deliveryMode':'warehouse','sql':'','fields':fields,
        'nodes':[{'id':'input','type':'input','label':'input','x':0,'y':0,'config':''}],'edges':[],'cleaning':[],'qualityRuleIds':[],'maskPolicyIds':[],
        'schedule':{'mode':'manual','cron':'0 9 * * *','intervalMinutes':1,'timezone':'Asia/Shanghai','retries':0,'timeoutSeconds':300,'concurrency':1,'dependencies':[]},
        'output':{'table':'pg_'+suffix,'layer':'DWD','keys':[],'writeMode':'replace'}}
    dataset={'name':'postgresql_'+suffix,'description':'synthetic acceptance','owner':'test','tags':[],'definition':definition}
    key=lambda:{'Idempotency-Key':str(uuid.uuid4())}
    def create(value):
        did=client.call('POST','/datasets',value,expected=201)[0]['data']['id']
        client.call('POST','/datasets/'+did+'/publish',extra_headers=key())
        return did
    def run(dataset_id):
        rid=client.call('POST','/datasets/'+dataset_id+'/runs',{},expected=201,extra_headers=key())[0]['data']['id']
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            state=client.call('GET','/runs/'+rid)[0]['data']
            if state['status'] in ('succeeded','failed','blocked','canceled'):break
            time.sleep(.2)
        assert state['status']=='succeeded',state['errorCode']
        assert state['rowCount']=='1201',state['rowCount']
        return state
    did=create(dataset);run(did)
    warehouse=client.call('GET','/warehouse/tables/'+did)[0]['data']
    assert warehouse['rowCount']=='1201'
    warehouse_rows=client.call('POST','/queries',{'sql':'SELECT * FROM '+warehouse['name']+' LIMIT 100'},expected=201,extra_headers=key())[0]['data']['rows']
    assert len(warehouse_rows)==100 and all(int(row['id'])>9007199254740992 and row['amount']=='12345.6700' for row in warehouse_rows)
    sql_definition={**definition,'mode':'sql','objectId':'','sql':'SELECT * FROM "Retail"."Orders"','deliveryMode':'direct','output':{**definition['output'],'table':''}}
    sql_body={**dataset,'name':'pg_direct_'+suffix,'definition':sql_definition}
    assert client.call('POST','/datasets/preview',sql_body)[0]['data']['rows']
    unsafe={**sql_body,'definition':{**sql_definition,'sql':"SELECT nextval('synthetic_sequence') AS id"}}
    assert client.call('POST','/datasets/preview',unsafe,expected=422)[0]['error']['code']=='UNSUPPORTED_SQL'
    direct=create(sql_body)
    assert client.call('POST','/datasets/'+direct+'/query',{'limit':100})[0]['data']['rows']
    visual_direct=create({**dataset,'name':'pg_table_direct_'+suffix,'definition':{**definition,'deliveryMode':'direct'}})
    assert client.call('POST','/datasets/'+visual_direct+'/query',{'limit':100})[0]['data']['rows']
    sql_body={**sql_body,'name':'pg_sql_'+suffix,'definition':{**sql_definition,'deliveryMode':'warehouse','output':{**definition['output'],'table':'pg_sql_'+suffix}}}
    sql_id=create(sql_body);run(sql_id)
    report={'status':'passed','sourceId':sid,'datasetId':did,'directDatasetId':direct,'visualDirectDatasetId':visual_direct,'sqlWarehouseId':sql_id,'rowCount':'1201','connector':json.loads(Path('.local/postgresql-connector-test.json').read_text())}
    Path('.local/postgresql-test.json').write_text(json.dumps(report,indent=2))
    print('PASS real PostgreSQL API: credential/schema/type, preview, table+SQL direct queries and 1201-row Doris snapshots with exact integer/decimal values')


if __name__=='__main__':main()
