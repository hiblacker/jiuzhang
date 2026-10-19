#!/usr/bin/env python3
"""Real dashboard totals, seven days and role-scoped audit projection."""
from importlib import import_module
import os, uuid
Client = import_module('test-identity').Client

def main():
    admin = Client()
    admin.call('POST', '/auth/login', {'username': os.environ['JIUZHANG_BOOTSTRAP_USER'], 'password': os.environ['JIUZHANG_BOOTSTRAP_PASSWORD']})
    data = admin.call('GET', '/overview')[0]['data']
    assert len(data['trend']) == 7 and len(data['layerCounts']) == 4, data
    assert data['sourceCount'] == admin.call('GET', '/sources?pageSize=1')[0]['meta']['total']
    assert data['datasetCount'] == admin.call('GET', '/datasets?pageSize=1')[0]['meta']['total']
    assert data['runCount'] == admin.call('GET', '/runs?pageSize=1')[0]['meta']['total']
    assert data['recentAudit'] and all(r['status'] in ['failed','blocked'] for r in data['recentFailures'])
    assert sum(x['tables'] for x in data['layerCounts']) == data['tableCount']
    name = 'overview_' + uuid.uuid4().hex[:8]
    password = uuid.uuid4().hex
    user = admin.call('POST','/system/users',{'username':name,'name':name,'password':password,'role':'viewer','enabled':True},expected=201)[0]['data']
    try:
        viewer = Client()
        viewer.call('POST','/auth/login',{'username':name,'password':password})
        assert viewer.call('GET','/overview')[0]['data']['recentAudit'] == []
        viewer.call('GET','/system/audit',expected=403)
    finally:
        admin.call('PATCH','/system/users/'+user['id'],{'enabled':False})
    print('PASS real overview: complete totals, layer counts, seven days, bounded failures, server audit permission')

if __name__ == '__main__': main()
