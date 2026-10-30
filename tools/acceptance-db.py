"""Owned real-engine test sessions, using the application's configured PostgreSQL endpoint."""
from importlib import import_module
from pathlib import Path
import json
import os
import select
import subprocess
import tempfile
import zipfile


class Session:
    def __init__(self):
        self.closed = False
        local = import_module('local-stack')
        self.directory = tempfile.TemporaryDirectory(prefix='acceptance-db-', dir=local.LOCAL)
        with zipfile.ZipFile(local.ROOT/'apps/worker/target/worker-0.1.0-SNAPSHOT.jar') as archive:
            for item in archive.infolist():
                if item.filename.startswith('BOOT-INF/lib/') and item.filename.endswith('.jar'):
                    (Path(self.directory.name)/Path(item.filename).name).write_bytes(archive.read(item))
        classpath = str(local.ROOT/'modules/platform/target/classes')+os.pathsep+self.directory.name+'/*'
        self.log = (local.LOCAL/'acceptance-metadata.log').open('a')
        self.process = subprocess.Popen(['java','-cp',classpath,'tools/java/AcceptanceDatabase.java'],
            cwd=local.ROOT,env=local.environment(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=self.log,text=True,bufsize=1)
        try:
            if self._read().get('ready') is not True:
                raise AssertionError('Acceptance database did not become ready')
        except BaseException:
            self.close()
            raise

    def _read(self):
        if not select.select([self.process.stdout],[],[],40)[0]:
            raise AssertionError('Timed out waiting for acceptance database response')
        line=self.process.stdout.readline()
        if not line:
            raise AssertionError('Acceptance database exited; inspect .local/acceptance-*.log')
        result=json.loads(line)
        if 'error' in result:
            raise AssertionError('Acceptance SQL failed: '+result['error']+' / '+result['sqlState'])
        return result

    def request(self, body):
        self.process.stdin.write(json.dumps(body)+'\n')
        self.process.stdin.flush()
        return self._read()

    def execute(self, sql, params=()):
        return self.request({'sql':sql,'params':list(params)})

    def query(self, sql, params=()):
        results=self.execute(sql,params)['results']
        return results[-1]['rows'] if results else []

    def scalar(self, sql, params=()):
        return next(iter(self.query(sql,params)[0].values()))

    def next(self, schedule, after):
        return self.request({'operation':'next','schedule':schedule,'after':after})['next']

    def close(self):
        if self.closed: return
        self.closed = True
        if self.process.poll() is None:
            self.process.stdin.close()
            try: self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill();self.process.wait(timeout=5)
        self.process.stdout.close()
        self.log.close()
        self.directory.cleanup()

    def __enter__(self): return self
    def __exit__(self, *_): self.close()
