#!/usr/bin/env python3
"""Real PostgreSQL/S3/API/Worker/Doris Excel acceptance with synthetic workbooks."""
from importlib import import_module
from pathlib import Path
from xml.sax.saxutils import escape
import io
import json
import os
import time
import urllib.error
import urllib.request
import uuid
import zipfile

identity = import_module('test-identity')
Client = identity.Client


def workbook(amount='12345.6700', duplicate=False):
    output = io.BytesIO()
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    def text(ref, value):
        return '<c r="'+ref+'" t="inlineStr"><is><t>'+escape(value)+'</t></is></c>'
    headers = ['id', 'amount', '客户名称', 'phone', 'enabled']
    if duplicate:
        headers[1] = 'ID'
    rows = '<row r="1">'+text('A1', 'Synthetic report')+'</row><row r="2">'
    rows += ''.join(text(chr(65+i)+'2', name) for i, name in enumerate(headers))+'</row>'
    rows += '<row r="3">'+text('A3', '9007199254740993')+'<c r="B3"><v>'+amount+'</v></c>'+text('C3', '00123')+text('D3', '13800138000')+'<c r="E3" t="b"><v>0</v></c></row>'
    rows += '<row r="4">'+text('A4', '00001')+'<c r="B4"><v>0.0000</v></c><c r="E4" t="b"><v>1</v></c></row>'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml', '<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reference" sheetId="1" r:id="rId1"/><sheet name="Orders" sheetId="2" r:id="rId2"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="'+ns+'"><sheetData><row r="1">'+text('A1','reference')+'</row></sheetData></worksheet>')
        z.writestr('xl/worksheets/sheet2.xml', '<worksheet xmlns="'+ns+'"><sheetData>'+rows+'</sheetData></worksheet>')
    return output.getvalue()


def upload(client, content, expected=201, filename='synthetic.xlsx', csrf=True):
    boundary = 'jz_excel_' + uuid.uuid4().hex
    data = ('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+filename+'"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() + content + ('\r\n--'+boundary+'--\r\n').encode()
    headers = {'Content-Type': 'multipart/form-data; boundary='+boundary}
    if csrf: headers['X-CSRF-Token'] = client.csrf
    request = urllib.request.Request(identity.BASE+'/sources/excel-files', data=data, headers=headers, method='POST')
    try: response = client.http.open(request, timeout=45)
    except urllib.error.HTTPError as error: response = error
    result = json.loads(response.read())
    assert response.code == expected, (response.code, expected, result)
    return result


def main():
    c = Client()
    upload(c, workbook(), expected=401)
    c.call('POST', '/auth/login', {'username': os.environ['JIUZHANG_BOOTSTRAP_USER'], 'password': os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    upload(c, workbook(), expected=403, csrf=False)
    assert upload(c, b'', expected=422)['error']['code'] == 'EXCEL_LIMIT'
    assert upload(c, bytes(20971521), expected=413)['error']['code'] == 'EXCEL_LIMIT'
    c.call('POST','/sources/excel-files',{'file':'not-multipart'},expected=422)
    assert upload(c, b'invalid', expected=422)['error']['code'] == 'EXCEL_FILE_INVALID'
    first = upload(c, workbook())['data']
    assert first['sheets'] == ['Reference', 'Orders']
    preview, _ = c.call('POST', '/sources/excel-files/'+first['id']+'/preview', {'sheet': 'Orders', 'headerRow': 2})
    assert preview['data']['rows'][0]['id'] == '9007199254740993'
    assert preview['data']['rows'][0]['amount'] == '12345.6700'
    assert preview['data']['rows'][0]['enabled'] is False
    assert preview['data']['rows'][1]['客户名称'] is None
    c.call('POST', '/sources/excel-files/'+first['id']+'/preview', {'sheet': 'Missing', 'headerRow': 2}, expected=422)
    duplicate = upload(c, workbook(duplicate=True))['data']
    error, _ = c.call('POST', '/sources/excel-files/'+duplicate['id']+'/preview', {'sheet':'Orders','headerRow':2}, expected=422)
    assert error['error']['code'] == 'EXCEL_HEADER_INVALID'
    suffix = uuid.uuid4().hex[:10]
    source_body = {'name':'excel_'+suffix,'description':'synthetic Excel acceptance','owner':'test','tags':[],'type':'Excel','settings':{'fileId':first['id'],'sheet':'Orders','headerRow':2}}
    c.call('POST','/sources/test',source_body)
    source, _ = c.call('POST','/sources',source_body,expected=201)
    sid = source['data']['id']
    assert source['data']['type'] == 'Excel' and not source['data']['credentialConfigured']
    objects, _ = c.call('GET','/sources/'+sid+'/objects')
    obj = objects['data'][0]
    fields = obj['fields']
    chinese = next(f for f in fields if f['name']=='客户名称')
    assert chinese['target'].startswith('field_')
    mask, _ = c.call('POST','/governance/masking',{'name':'excel_mask_'+suffix,'description':'','owner':'test','tags':[],'kind':'mask','parameter':'3,4','enabled':True},expected=201)
    for field in fields:
        if field['name']=='phone': field.update(sensitive=True,maskPolicyId=mask['data']['id'])
    definition = {'sourceId':sid,'objectId':obj['id'],'upstreamDatasetId':'','mode':'visual','deliveryMode':'warehouse','sql':'','fields':fields,'nodes':[{'id':'input','type':'input','label':'input','x':0,'y':0,'config':''}],'edges':[],'cleaning':[],'qualityRuleIds':[],'maskPolicyIds':[mask['data']['id']],'schedule':{'mode':'manual','cron':'0 9 * * *','intervalMinutes':60,'timezone':'Asia/Shanghai','retries':0,'timeoutSeconds':600,'concurrency':1,'dependencies':[]},'output':{'table':'excel_'+suffix,'layer':'DWD','keys':[],'writeMode':'replace'}}
    body = {'name':'excel_dataset_'+suffix,'description':'','owner':'test','tags':[],'definition':definition}
    dataset, _ = c.call('POST','/datasets',body,expected=201)
    did = dataset['data']['id']
    version, _ = c.call('POST','/datasets/'+did+'/publish',extra_headers={'Idempotency-Key':str(uuid.uuid4())})
    assert version['data']['sourceFileSnapshot']['fileId'] == first['id']
    direct_body = json.loads(json.dumps(body));direct_body['name']='excel_direct_'+suffix
    direct_body['definition']['deliveryMode']='direct';direct_body['definition']['output']['table']=''
    direct, _ = c.call('POST','/datasets',direct_body,expected=201); direct_id=direct['data']['id']
    c.call('POST','/datasets/'+direct_id+'/publish',extra_headers={'Idempotency-Key':str(uuid.uuid4())})
    second = upload(c,workbook('99.0100'))['data']
    c.call('PATCH','/sources/'+sid,{'settings':{'fileId':second['id'],'sheet':'Orders','headerRow':2}})
    query, _ = c.call('POST','/datasets/'+direct_id+'/query',{'limit':100})
    assert query['data']['rows'][0]['amount']=='12345.6700', 'Direct published version changed after source replacement'
    run, _ = c.call('POST','/datasets/'+did+'/runs',{},expected=201,extra_headers={'Idempotency-Key':str(uuid.uuid4())})
    deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        detail, _ = c.call('GET','/runs/'+run['data']['id'])
        if detail['data']['status'] in ['succeeded','failed','blocked','canceled']: break
        time.sleep(0.5)
    assert detail['data']['status']=='succeeded', detail['data'].get('errorCode')
    table, _ = c.call('GET','/warehouse/tables/'+did)
    assert table['data']['rowCount']=='2'
    assert any(row['id']=='9007199254740993' and row['amount']=='12345.6700' for row in table['data']['sample'])
    assert all(row.get('phone') is None or '*' in row['phone'] for row in table['data']['sample'])
    latest,_=c.call('POST','/datasets/'+did+'/publish',extra_headers={'Idempotency-Key':str(uuid.uuid4())})
    assert latest['data']['sourceFileSnapshot']['fileId']==second['id']
    next_run,_=c.call('POST','/datasets/'+did+'/runs',{},expected=201,extra_headers={'Idempotency-Key':str(uuid.uuid4())})
    deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        result,_=c.call('GET','/runs/'+next_run['data']['id'])
        if result['data']['status'] in ['succeeded','failed','blocked','canceled']:break
        time.sleep(0.5)
    assert result['data']['status']=='succeeded',result['data'].get('errorCode')
    replaced,_=c.call('GET','/warehouse/tables/'+did)
    assert replaced['data']['rowCount']=='2' and any(row['amount']=='99.0100' for row in replaced['data']['sample'])
    c.call('DELETE','/sources/'+sid,expected=409)
    c.call('PATCH','/sources/'+sid,{'type':'MySQL'},expected=409)
    bad=json.loads(json.dumps(body));bad['definition'].update(mode='sql',sql='SELECT * FROM Orders',fields=[])
    rejection,_=c.call('POST','/datasets/preview',bad,expected=422)
    assert rejection['error']['code']=='SOURCE_SQL_UNSUPPORTED'
    for role in ['viewer','developer']:
        password=uuid.uuid4().hex;username='excel_'+role+'_'+suffix
        user,_=c.call('POST','/system/users',{'username':username,'password':password,'name':'synthetic Excel permission test','role':role,'enabled':True},expected=201)
        actor=Client();actor.call('POST','/auth/login',{'username':username,'password':password})
        if role=='viewer': upload(actor,workbook(),expected=403)
        else:
            owned=upload(actor,workbook())['data']
            actor.call('GET','/sources/excel-files/'+owned['id'])
            actor.call('GET','/sources/excel-files/'+first['id'])
            actor.call('GET','/sources/excel-files/'+duplicate['id'],expected=403)
        actor.call('POST','/sources/excel-files/'+first['id']+'/preview',{'sheet':'Orders','headerRow':2},expected=403)
        c.call('PATCH','/system/users/'+user['data']['id'],{'enabled':False})
    Path('.local/excel-source-fixture.xlsx').write_bytes(workbook())
    Path('.local/excel-test.json').write_text(json.dumps({'sourceId':sid,'datasetId':did,'directId':direct_id,'fileId':first['id']}))
    print('PASS real Excel: upload/auth/CSRF/roles, worksheets/header validation, exact values/null/false, Chinese fields, frozen direct+Worker versions after replacement, masking, Doris publication and new-version replacement')


def retained():
    c=Client();c.call('POST','/auth/login',{'username':os.environ['JIUZHANG_BOOTSTRAP_USER'],'password':os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    fixture=json.loads(Path('.local/excel-test.json').read_text())
    c.call('GET','/sources/'+fixture['sourceId']+'/objects')
    old,_=c.call('POST','/datasets/'+fixture['directId']+'/query',{'limit':100})
    assert old['data']['rows'][0]['amount']=='12345.6700'
    latest,_=c.call('GET','/warehouse/tables/'+fixture['datasetId'])
    assert latest['data']['rowCount']=='2' and any(row['amount']=='99.0100' for row in latest['data']['sample'])
    print('PASS retained Excel source/file versions and Doris snapshot after API/Worker restart')


if __name__=='__main__':
    import sys
    retained() if '--retained' in sys.argv else main()
