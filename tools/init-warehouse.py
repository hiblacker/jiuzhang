#!/usr/bin/env python3
"""Create local Doris database and a database-scoped account; password sent only over stdin."""
from pathlib import Path
import subprocess
values=dict(line.split('=',1) for line in Path('.env').read_text().splitlines() if '=' in line)
password=values['WAREHOUSE_PASSWORD']
assert password.isalnum()
sql="CREATE DATABASE IF NOT EXISTS jiuzhang; CREATE USER IF NOT EXISTS 'jiuzhang' IDENTIFIED BY '"+password+"'; SET PASSWORD FOR 'jiuzhang' = PASSWORD('"+password+"'); GRANT SELECT_PRIV,LOAD_PRIV,ALTER_PRIV,CREATE_PRIV,DROP_PRIV,SHOW_VIEW_PRIV ON jiuzhang.* TO 'jiuzhang';"
p=subprocess.run(['docker','compose','-f','infra/doris.compose.yaml','exec','-T','warehouse-fe','mysql','-h127.0.0.1','-P9030','-uroot'],input=sql,text=True,capture_output=True)
if p.returncode:raise SystemExit('Doris initialization failed: '+p.stderr.replace(password,'[REDACTED]'))
print('Initialized local Doris database and scoped service account.')
