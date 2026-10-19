#!/usr/bin/env python3
"""Provision the explicitly requested local synthetic MySQL fixture; never touches external sources."""
from pathlib import Path
import os
import secrets
import subprocess

root = Path(__file__).resolve().parent.parent
os.chdir(root)
envfile = root / '.env'
if not envfile.exists():
    subprocess.run(['bash', 'tools/local-env.sh'], check=True)
values = dict(line.split('=', 1) for line in envfile.read_text().splitlines() if '=' in line)
if 'SOURCE_READ_PASSWORD' not in values:
    values['SOURCE_READ_PASSWORD'] = secrets.token_hex(24)
    with envfile.open('a') as file:
        file.write('SOURCE_READ_PASSWORD=' + values['SOURCE_READ_PASSWORD'] + '\n')
subprocess.run(['docker', 'compose', '--env-file', '.env', '-f', 'infra/compose.yaml',
    '--profile', 'source', 'up', '-d', '--wait', 'source'], check=True)
sql = ''
sql += "CREATE USER IF NOT EXISTS 'jiuzhang_reader'@'%' IDENTIFIED WITH caching_sha2_password BY '" + values['SOURCE_READ_PASSWORD'] + "';\n"
sql += "GRANT SELECT, SHOW VIEW ON demo_retail.* TO 'jiuzhang_reader'@'%';\n"
subprocess.run(['docker', 'exec', '-i', '-e', 'MYSQL_PWD=' + values['SOURCE_ROOT_PASSWORD'],
    'jiuzhang-source-1', 'mysql', '-uroot', 'demo_retail'], input=sql, text=True, check=True)
(root / '.local').mkdir(exist_ok=True)
public_key = subprocess.check_output(['docker', 'exec', 'jiuzhang-source-1', 'cat', '/var/lib/mysql/public_key.pem'])
(root / '.local/mysql-public-key.pem').write_bytes(public_key)
print('Local synthetic MySQL initialized. Read-only credentials remain in private .env.')
