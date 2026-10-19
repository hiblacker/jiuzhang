#!/usr/bin/env python3
"""Local single-machine lifecycle. Never removes volumes or stops unowned processes."""
from pathlib import Path
import argparse, datetime, hashlib, hmac, json, os, shutil, signal, socket, subprocess, sys, time, urllib.error, urllib.parse, urllib.request, uuid

ROOT=Path(__file__).resolve().parent.parent
LOCAL=ROOT/'.local'
COMPOSE=['docker','compose','--env-file','.env','-f','infra/compose.yaml','-f','infra/doris.compose.yaml','-f','infra/storage.compose.yaml','--profile','source']
SERVICES={'api':8080,'worker':None,'web':5175}


def run(command,**kwargs):
    return subprocess.run(command,cwd=ROOT,check=True,**kwargs)


def environment():
    result=dict(os.environ)
    for line in (ROOT/'.env').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key,value=line.split('=',1);result[key]=value
    return result


def identity(pid):
    try:
        stat=Path('/proc',str(pid),'stat').read_text()
        tail=stat[stat.rindex(')')+2:].split()
        if tail[0]=='Z':return None
        return tail[19]
    except (FileNotFoundError,ProcessLookupError,PermissionError):return None


def managed(role):
    file=LOCAL/(role+'.process.json')
    if not file.exists():return None
    record=json.loads(file.read_text())
    return record if identity(record['pid'])==record['start'] else None


def alive(port):
    if port is None:return False
    with socket.socket() as connection:
        connection.settimeout(.2)
        return connection.connect_ex(('127.0.0.1',port))==0


def wait_for(check,label,seconds=180):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if check():return
        time.sleep(1)
    raise RuntimeError(label+' did not become ready; inspect .local/logs and docker compose logs')


def s3_request(method,key=None,body=None):
    env=environment()
    endpoint=env.get('OBJECTS_ENDPOINT','http://127.0.0.1:18333').rstrip('/')
    address=urllib.parse.urlsplit(endpoint)
    path='/'+env.get('OBJECTS_BUCKET','jiuzhang-raw')
    if key is not None:path+='/'+urllib.parse.quote(key,safe='/')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    day=stamp[:8];digest=hashlib.sha256(body or b'').hexdigest()
    headers='host;x-amz-content-sha256;x-amz-date'
    canonical=method+'\n'+path+'\n\nhost:'+address.netloc+'\nx-amz-content-sha256:'+digest+'\nx-amz-date:'+stamp+'\n\n'+headers+'\n'+digest
    scope=day+'/us-east-1/s3/aws4_request'
    signing=('AWS4'+env['OBJECTS_SECRET_KEY']).encode()
    for part in [day,'us-east-1','s3','aws4_request']:
        signing=hmac.new(signing,part.encode(),hashlib.sha256).digest()
    message='AWS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+hashlib.sha256(canonical.encode()).hexdigest()
    signature=hmac.new(signing,message.encode(),hashlib.sha256).hexdigest()
    auth='AWS4-HMAC-SHA256 Credential='+env['OBJECTS_ACCESS_KEY']+'/'+scope+', SignedHeaders='+headers+', Signature='+signature
    request=urllib.request.Request(endpoint+path,method=method,data=body,headers={
        'X-Amz-Date':stamp,'X-Amz-Content-SHA256':digest,'Authorization':auth})
    try:
        with urllib.request.urlopen(request,timeout=3) as response:return response.status
    except urllib.error.HTTPError as error:return error.code


def wait_storage():
    key='readiness/'+uuid.uuid4().hex
    def ready():
        try:
            status=s3_request('HEAD')
            if status==404:status=s3_request('PUT',body=b'')
            if status in [401,403]:raise RuntimeError('Local S3 credentials rejected; check private configuration')
            return status==200 and s3_request('PUT',key,b'local readiness')==200 and s3_request('HEAD',key)==200 and s3_request('DELETE',key) in [200,204]
        except OSError:return False
    wait_for(ready,'S3 authenticated read/write/delete',180)


def infrastructure():
    for executable in ['docker','python3','openssl']:
        if not shutil.which(executable):raise RuntimeError('Missing prerequisite: '+executable)
    run(['bash','tools/local-env.sh'])
    run(['python3','tools/init-storage.py'])
    if sys.platform.startswith('linux'):
        value=Path('/proc/sys/vm/max_map_count')
        if value.exists() and int(value.read_text())<2000000:
            print('Doris recommends vm.max_map_count >= 2000000; the script does not change host sysctl.',flush=True)
    run(COMPOSE+['up','-d','--wait','--wait-timeout','240'])
    run(['python3','tools/init-source.py'])
    def doris_ready():
        command=COMPOSE+['exec','-T','warehouse-fe','mysql','-h127.0.0.1','-P9030','-uroot','-B','-N','-e','SHOW BACKENDS']
        output=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
        return output.returncode==0 and any(len(row.split('\t'))>9 and row.split('\t')[9]=='true' for row in output.stdout.splitlines())
    wait_for(doris_ready,'Doris backend',240)
    wait_storage()
    run(['python3','tools/init-warehouse.py'])


def unowned_worker():
    # This project-specific check catches Workers started in a separate terminal.
    for cmdline in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            args=cmdline.read_bytes().decode(errors='replace').split(chr(0))
            same=Path('/proc',cmdline.parent.name,'cwd').resolve()==ROOT
            if same and any('.local/runtime/worker-' in arg for arg in args):
                return True
        except (FileNotFoundError,PermissionError,ProcessLookupError):pass
    return False


def ensure_offline():
    for role in ['api','worker']:
        if managed(role):raise RuntimeError('Stop managed API/Worker with bash tools/local.sh stop before migration')
    if alive(8080):raise RuntimeError('Port 8080 has an unowned process. Inspect and stop that project API before migration')
    if unowned_worker():raise RuntimeError('An unowned Worker is running; stop its terminal before migration')


def prepare():
    ensure_offline()
    for executable in ['java','pnpm']:
        if not shutil.which(executable):raise RuntimeError('Missing prerequisite: '+executable)
    infrastructure()
    run(['pnpm','install','--frozen-lockfile'])
    run(['bash','tools/backend.sh','build'])
    run(['bash','tools/backend.sh','migrate'])


def start(role):
    if managed(role):
        print(role+' already running (owned)',flush=True);return
    if alive(SERVICES[role]):raise RuntimeError('Port '+str(SERVICES[role])+' is occupied; no process was stopped')
    if role=='worker' and unowned_worker():raise RuntimeError('An unowned Worker is running; stop its terminal before managed startup')
    LOCAL.mkdir(exist_ok=True)
    logs=LOCAL/'logs';logs.mkdir(exist_ok=True)
    command=['pnpm','dev:real'] if role=='web' else ['bash','tools/backend.sh',role]
    with (logs/(role+'.log')).open('wb') as log:
        process=subprocess.Popen(command,cwd=ROOT,env=environment(),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    record={'pid':process.pid,'start':identity(process.pid),'root':str(ROOT),'role':role}
    (LOCAL/(role+'.process.json')).write_text(json.dumps(record))
    def ready():
        if identity(process.pid)!=record['start']:raise RuntimeError(role+' exited; inspect .local/logs/'+role+'.log')
        if role=='worker':
            return 'Started WorkerApplication' in (logs/(role+'.log')).read_text(errors='replace')[-10000:]
        if role=='api':
            try:
                with urllib.request.urlopen('http://127.0.0.1:8080/actuator/health',timeout=1) as response:
                    return json.load(response).get('status')=='UP'
            except (OSError,ValueError):return False
        return alive(SERVICES[role])
    wait_for(ready,role,90)
    print(role+' ready',flush=True)


def stop(role):
    record=managed(role)
    if not record:
        print(role+' has no live managed process; nothing stopped',flush=True);return
    os.killpg(record['pid'],signal.SIGTERM)
    wait_for(lambda:identity(record['pid'])!=record['start'],role+' shutdown',25)
    (LOCAL/(role+'.process.json')).unlink(missing_ok=True)
    print(role+' stopped; data volumes preserved',flush=True)


def verify():
    env=environment()
    run(['python3','tools/test-migrations.py'],env=env)
    for name in ['identity','sources','datasets','execution','warehouse','execution-safety','execution-rules','overview']:
        run(['python3','tools/test-'+name+'.py'],env=env)
    for name in ['contracts','identity','sources','datasets','execution','overview']:
        run(['node','tools/test-real-'+name+'.mjs'],env=env)
    print('PASS sequential real-engine/API/browser acceptance. Crash test is separate and requires exclusive Worker ownership.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['up','prepare','infra','start','stop','status','verify'])
    parser.add_argument('role',nargs='?',choices=SERVICES)
    args=parser.parse_args()
    os.chdir(ROOT)
    if args.action in ['up','prepare']:prepare()
    if args.action=='infra':infrastructure()
    if args.action in ['up','start']:
        for role in ([args.role] if args.role else SERVICES):start(role)
        print('Real frontend: http://localhost:5175/login ; credentials are in private .env (never printed).')
    if args.action=='stop':
        for role in ([args.role] if args.role else reversed(SERVICES)):stop(role)
    if args.action=='status':
        for role,port in SERVICES.items():print(role+': '+('managed/running' if managed(role) else 'unmanaged/listening' if alive(port) else 'stopped or unowned'))
    if args.action=='verify':verify()

if __name__=='__main__':
    try:main()
    except (RuntimeError,subprocess.CalledProcessError) as error:
        print('Local startup failed: '+str(error),file=sys.stderr);sys.exit(1)
