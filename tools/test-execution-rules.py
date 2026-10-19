#!/usr/bin/env python3
"""Actual quality severity, empty-first-run, conversion and source-contract failures."""
from importlib import import_module
from pathlib import Path
import copy, json, os, time, uuid
Client=import_module('test-identity').Client
sql=import_module('test-execution-safety').sql


def main():
    c=Client();c.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    suffix=uuid.uuid4().hex[:8];table='rules_'+suffix
    sql('source','CREATE TABLE '+table+' LIKE orders;')
    source=json.loads(Path('.local/source-test.json').read_text())
    obj=next(x for x in c.call('GET','/sources/'+source['id']+'/objects')[0]['data'] if x['name']==table)
    body=copy.deepcopy(json.loads(Path('.local/dataset-test.json').read_text())['body'])
    body['name']='rules_'+suffix;body['definition']['objectId']=obj['id'];body['definition']['qualityRuleIds']=[];body['definition']['output']['table']='rules_'+suffix
    d=c.call('POST','/datasets',body,expected=201)[0]['data'];did=d['id']
    key=lambda:{'Idempotency-Key':str(uuid.uuid4())}
    def publish():return c.call('POST','/datasets/'+did+'/publish',extra_headers=key())[0]['data']
    def execute(expected='succeeded',code=None):
        run=c.call('POST','/datasets/'+did+'/runs',{},expected=201,extra_headers=key())[0]['data']
        end=time.monotonic()+90
        while time.monotonic()<end:
            result=c.call('GET','/runs/'+run['id'])[0]['data']
            if result['status'] in ['succeeded','failed','blocked','canceled']:break
            time.sleep(.2)
        assert result['status']==expected,result
        if code:assert result['errorCode']==code,result
        return result
    def rows():return c.call('GET','/warehouse/tables/'+did)[0]['data']['rowCount']
    publish();execute();assert rows()=='0'
    sql('source','INSERT INTO '+table+' SELECT * FROM orders;')
    execute();assert rows()=='3'
    rule=c.call('POST','/governance/quality',{'name':'rules_'+suffix,'description':'','owner':'acceptance','tags':[],'kind':'range','field':'amount','parameter':'0,1','severity':'BLOCK','enabled':True},expected=201)[0]['data']
    body['definition']['qualityRuleIds']=[rule['id']]
    c.call('PATCH','/datasets/'+did,{'definition':body['definition']});publish()
    blocked=execute('blocked','QUALITY_BLOCKED');assert rows()=='3' and blocked['qualityResults'][0]['result']=='BLOCK'
    c.call('PATCH','/governance/quality/'+rule['id'],{'severity':'WARN'})
    publish();warn=execute();assert warn['qualityResults'][0]['result']=='WARN'
    # The previously published BLOCK version stays immutable despite changing the current rule.
    retried=c.call('POST','/runs/'+blocked['id']+'/retry',{},expected=201,extra_headers=key())[0]['data']
    end=time.monotonic()+60
    while time.monotonic()<end:
        result=c.call('GET','/runs/'+retried['id'])[0]['data']
        if result['status'] in ['blocked','failed','succeeded']:break
        time.sleep(.2)
    assert result['status']=='blocked' and result['datasetVersion']==blocked['datasetVersion']
    # An explicit narrowing conversion must fail and preserve the previous snapshot.
    body['definition']['qualityRuleIds']=[]
    next(f for f in body['definition']['fields'] if f['name']=='amount')['type']='decimal(4,2)'
    c.call('PATCH','/datasets/'+did,{'definition':body['definition']});publish()
    execute('failed','DATASET_CONVERSION_FAILED');assert rows()=='3'
    next(f for f in body['definition']['fields'] if f['name']=='amount')['type']='decimal(20,4)'
    c.call('PATCH','/datasets/'+did,{'definition':body['definition']});publish()
    for change,restore in [('MODIFY phone varchar(31) NULL','MODIFY phone varchar(30) NULL'),('MODIFY phone varchar(30) NOT NULL','MODIFY phone varchar(30) NULL')]:
        if 'NOT NULL' in change:sql('source','UPDATE '+table+" SET phone='synthetic' WHERE phone IS NULL;")
        sql('source','ALTER TABLE '+table+' '+change+';')
        execute('blocked','SCHEMA_CHANGED');assert rows()=='3'
        sql('source','ALTER TABLE '+table+' '+restore+';')
    sql('source','ALTER TABLE '+table+' DROP COLUMN phone;')
    execute('blocked','SCHEMA_CHANGED');assert rows()=='3'
    print('PASS actual rules: initial empty, BLOCK/WARN, immutable retry rules, conversion overflow, used length/nullability/drop drift, old snapshot retained')

if __name__=='__main__':main()
