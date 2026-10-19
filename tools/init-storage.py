#!/usr/bin/env python3
"""Prepare private local S3 credentials; no secret is emitted to stdout."""
from pathlib import Path
import json
import secrets
import os
values={}
path=Path('.env')
for line in path.read_text().splitlines():
 if '=' in line:
  key,value=line.split('=',1);values[key]=value
for key in ['OBJECTS_ACCESS_KEY','OBJECTS_SECRET_KEY','WAREHOUSE_PASSWORD']:
 if key not in values:
  value=secrets.token_hex(24)
  with path.open('a') as f:f.write(key+'='+value+'\n')
  values[key]=value
os.chmod(path,0o600)
config=Path('.local/s3.json');config.parent.mkdir(exist_ok=True)
config.write_text(json.dumps({'identities':[{'name':'jiuzhang','credentials':[{'accessKey':values['OBJECTS_ACCESS_KEY'],'secretKey':values['OBJECTS_SECRET_KEY']}],'actions':['Admin','Read','Write','List','Tagging']}]}))
os.chmod(config,0o600)
print('Prepared private S3 and warehouse credentials.')
