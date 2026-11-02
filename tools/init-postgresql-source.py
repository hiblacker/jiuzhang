#!/usr/bin/env python3
"""Provision only the project's isolated PostgreSQL source fixture, including local TLS."""
from pathlib import Path
import argparse
import os
import secrets
import subprocess

ROOT=Path(__file__).resolve().parent.parent


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reset',action='store_true',help='Reset only the isolated synthetic source tables for acceptance')
    args=parser.parse_args()
    os.chdir(ROOT)
    subprocess.run(['bash','tools/local-env.sh'],check=True)
    values=dict(line.split('=',1) for line in Path('.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    defaults={'POSTGRESQL_SOURCE_ADMIN_PASSWORD':secrets.token_hex(24),'POSTGRESQL_SOURCE_PASSWORD':secrets.token_hex(24),
        'JIUZHANG_POSTGRESQL_SSL_ROOT_CERT':'.local/postgresql-source/ca.crt'}
    with Path('.env').open('a') as file:
        for key,value in defaults.items():
            if key not in values:values[key]=value;file.write(key+'='+value+'\n')
    certs=Path('.local/postgresql-source');certs.mkdir(parents=True,exist_ok=True)
    if not (certs/'server.key').exists():
        commands=[
            ['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','3650','-subj','/CN=Jiuzhang local PostgreSQL source CA','-keyout',str(certs/'ca.key'),'-out',str(certs/'ca.crt')],
            ['openssl','req','-newkey','rsa:2048','-nodes','-subj','/CN=localhost','-keyout',str(certs/'server.key'),'-out',str(certs/'server.csr')]]
        for command in commands:subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (certs/'server.ext').write_text('subjectAltName=DNS:localhost,DNS:postgresql-source\nextendedKeyUsage=serverAuth\n')
        subprocess.run(['openssl','x509','-req','-in',str(certs/'server.csr'),'-CA',str(certs/'ca.crt'),'-CAkey',str(certs/'ca.key'),'-CAcreateserial','-days','3650','-extfile',str(certs/'server.ext'),'-out',str(certs/'server.crt')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for name in ['ca.key','server.key']:(certs/name).chmod(0o600)
    if not (certs/'wrong-ca.crt').exists():
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','3650','-subj','/CN=Untrusted local test CA','-keyout',str(certs/'wrong-ca.key'),'-out',str(certs/'wrong-ca.crt')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (certs/'wrong-ca.key').chmod(0o600)
    subprocess.run(['docker','compose','--env-file','.env','-f','infra/compose.yaml','--profile','source','up','-d','--wait','postgresql-source'],check=True)
    password=values['POSTGRESQL_SOURCE_PASSWORD']
    sql="DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='jiuzhang_reader') THEN CREATE ROLE jiuzhang_reader LOGIN; END IF; END $$;\n"
    sql+="ALTER ROLE jiuzhang_reader PASSWORD '"+password.replace("'","''")+"';\n"
    command=['docker','compose','--env-file','.env','-f','infra/compose.yaml','exec','-T','postgresql-source','psql','-U','postgres','-d','demo_retail','-v','ON_ERROR_STOP=1']
    initialized=subprocess.run(command+['-Atc',"SELECT to_regclass('\"Retail\".\"Orders\"') IS NOT NULL"],text=True,capture_output=True,check=True).stdout.strip()=='t'
    if args.reset or not initialized:sql+=Path('infra/fixtures/postgresql.sql').read_text()
    sql+="\nREVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE TEMP ON DATABASE demo_retail FROM PUBLIC;\nGRANT CONNECT ON DATABASE demo_retail TO jiuzhang_reader; GRANT USAGE ON SCHEMA public,\"Retail\" TO jiuzhang_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public,\"Retail\" TO jiuzhang_reader;\n"
    result=subprocess.run(command,input=sql,text=True,capture_output=True)
    if result.returncode:raise RuntimeError('PostgreSQL source fixture initialization failed; credentials suppressed')
    print('Local isolated PostgreSQL source initialized (17.6, Retail schema, 1201 rows, read-only account, local TLS).')


if __name__=='__main__':main()
