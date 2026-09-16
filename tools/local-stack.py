"""Manage a trusted local runtime manifest and make verified cold backups.

Only explicitly configured processes are started/stopped. No shell is used.
Credentials are read by JSON references; runtime configuration is not backed up.
"""
import argparse
import hashlib
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone


def fail(code):
    raise RuntimeError(code)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.part')
    with temp.open('w') as stream:
        os.chmod(temp, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def fingerprint(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'command='], text=True, capture_output=True)
    return result.stdout.strip() if result.returncode == 0 else None


def command(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)


class Stack:
    def __init__(self, config):
        self.config = config
        self.repo = Path(config['repository']).resolve(strict=True)
        self.root = Path(config['stateRoot']).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.pg = config['postgres']
        self.data = Path(self.pg['data']).resolve(strict=True)
        self.lake = Path(config['lakeRoot']).resolve(strict=True)
        self.services = config['services']
        if config.get('version') != 1 or not self.services or not (self.data / 'PG_VERSION').is_file():
            fail('INVALID_LOCAL_STACK')
        if self.root.is_relative_to(self.data) or self.root.is_relative_to(self.lake):
            fail('STATE_DIRECTORY_MUST_BE_SEPARATE')
        self.records_path = self.root / 'processes.json'
        self.records = json.loads(self.records_path.read_text()) if self.records_path.exists() else {}

    def pgctl(self, *args):
        return command([str(Path(self.pg['bin']) / 'pg_ctl'), '-D', str(self.data), *args])

    def status(self):
        return {'postgres': (self.data / 'postmaster.pid').exists(), 'services': {
            name: bool(self.records.get(name) and fingerprint(self.records[name]['pid']) == self.records[name]['fingerprint'])
            for name in self.services}}

    def start(self):
        if not (self.data / 'postmaster.pid').exists():
            sock = Path(self.pg['socket']); sock.mkdir(parents=True, exist_ok=True, mode=0o700)
            # PostgreSQL parses this option string; reject quotes/whitespace in the socket path.
            if any(c.isspace() or c in "'\"\\" for c in str(sock)):
                fail('INVALID_POSTGRES_SOCKET_PATH')
            self.pgctl('-l', str(self.root / 'postgres.log'), '-o', f"-h 127.0.0.1 -p {int(self.pg['port'])} -k {sock}", '-w', '-t', '30', 'start')
        for name, service in self.services.items():
            if self.status()['services'][name]:
                continue
            env = dict(os.environ, **service.get('env', {}))
            for key, ref in service.get('envRefs', {}).items():
                value = json.loads(Path(ref['file']).read_text())[ref['key']]
                env[key] = str(value)
            with (self.root / f'{name}.log').open('ab') as log:
                os.chmod(log.name, 0o600)
                process = subprocess.Popen(service['command'], cwd=self.repo, env=env, stdin=subprocess.DEVNULL,
                                           stdout=log, stderr=log, start_new_session=True)
            identity = fingerprint(process.pid)
            if not identity:
                fail('SERVICE_START_FAILED')
            self.records[name] = {'pid': process.pid, 'fingerprint': identity}
            write_json(self.records_path, self.records)
            deadline = time.monotonic() + 45
            while service.get('healthUrl'):
                try:
                    with urllib.request.urlopen(service['healthUrl'], timeout=2) as response:
                        if response.status == 200:
                            break
                except OSError:
                    pass
                if process.poll() is not None or time.monotonic() > deadline:
                    fail('SERVICE_HEALTH_FAILED')
                time.sleep(0.25)
            if process.poll() is not None:
                fail('SERVICE_START_FAILED')

    def stop(self):
        for name in reversed(self.services):
            record = self.records.get(name)
            if not record or fingerprint(record['pid']) != record['fingerprint']:
                continue
            os.kill(record['pid'], signal.SIGTERM)
            deadline = time.monotonic() + 45
            while fingerprint(record['pid']) == record['fingerprint']:
                if time.monotonic() > deadline:
                    fail('SERVICE_STOP_TIMEOUT')
                time.sleep(0.2)
        if (self.data / 'postmaster.pid').exists():
            self.pgctl('-m', 'fast', '-w', '-t', '30', 'stop')


def hashes(root):
    files = []
    for file in sorted(root.rglob('*')):
        if file.is_symlink():
            fail('BACKUP_SYMLINK_UNSUPPORTED')
        if file.is_dir():
            continue
        if not file.is_file():
            fail('BACKUP_SPECIAL_FILE_UNSUPPORTED')
        sha = hashlib.sha256()
        with file.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                sha.update(chunk)
        files.append({'path': file.relative_to(root).as_posix(), 'bytes': file.stat().st_size, 'sha256': sha.hexdigest()})
    return files


def copy_private(source, destination):
    # Reject links before copy so a backup cannot silently dereference external files.
    for file in source.rglob('*'):
        if file.is_symlink():
            fail('BACKUP_SYMLINK_UNSUPPORTED')
    shutil.copytree(source, destination, symlinks=True)
    for path in [destination, *destination.rglob('*')]:
        os.chmod(path, 0o700 if path.is_dir() else 0o600)
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def backup(stack, destination):
    target = Path(destination).resolve()
    if target.exists() or any(target.is_relative_to(root) for root in [stack.lake, stack.data, stack.root]):
        fail('BACKUP_TARGET_MUST_BE_NEW_AND_SEPARATE')
    # Stop consumers/writers before PostgreSQL. Every original service is restored in finally.
    was_running = stack.status()
    if not was_running['postgres'] or not all(was_running['services'].values()):
        fail('BACKUP_REQUIRES_HEALTHY_MANAGED_STACK')
    try:
        stack.stop()
        if (stack.data / 'postmaster.pid').exists() or any((stack.data / 'pg_tblspc').iterdir()):
            fail('COLD_BACKUP_REQUIRES_STOPPED_DATABASE_WITHOUT_EXTERNAL_TABLESPACES')
        target.mkdir(parents=True, mode=0o700)
        copy_private(stack.data, target / 'postgres')
        copy_private(stack.lake, target / 'lake')
        git_dir = target / 'git'; git_dir.mkdir(mode=0o700)
        for index, repository in enumerate([str(stack.repo), *stack.config.get('modelRepositories', [])]):
            bundle = git_dir / f'{index}.bundle'
            command(['git', '-C', repository, 'bundle', 'create', str(bundle), '--all'])
            with bundle.open('rb') as stream:
                os.fsync(stream.fileno())
        entries = hashes(target)
        write_json(target / 'manifest.json', {'version': 1, 'state': 'COMPLETE', 'kind': 'COLD_LOCAL',
            'createdAt': datetime.now(timezone.utc).isoformat(), 'postgresMajor': (stack.data / 'PG_VERSION').read_text().strip(),
            'gitRevision': command(['git', '-C', str(stack.repo), 'rev-parse', 'HEAD'], text=True).stdout.strip(),
            'files': entries, 'bytes': sum(entry['bytes'] for entry in entries)})
    finally:
        stack.start()
    return verify(target)


def verify(target):
    target = Path(target).resolve(strict=True)
    manifest = json.loads((target / 'manifest.json').read_text())
    if manifest.get('version') != 1 or manifest.get('state') != 'COMPLETE':
        fail('BACKUP_NOT_COMPLETE')
    actual = [item for item in hashes(target) if item['path'] != 'manifest.json']
    if actual != manifest['files']:
        fail('BACKUP_CHECKSUM_MISMATCH')
    return {'state': 'VERIFIED', 'files': len(actual), 'bytes': sum(item['bytes'] for item in actual),
            'postgresMajor': manifest['postgresMajor'], 'gitRevision': manifest['gitRevision']}


def restore(source, destination):
    result = verify(source)
    target = Path(destination).resolve()
    if target.exists():
        fail('RESTORE_TARGET_MUST_BE_NEW')
    copy_private(Path(source), target)
    verify(target)
    return {**result, 'state': 'RESTORED_OFFLINE'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop', 'status', 'backup', 'verify', 'restore'])
    parser.add_argument('--config'); parser.add_argument('--backup'); parser.add_argument('--destination')
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == 'verify':
        result = verify(args.backup)
    elif args.action == 'restore':
        result = restore(args.backup, args.destination)
    else:
        stack = Stack(json.loads(Path(args.config).read_text()))
        with (stack.root / 'operations.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.action == 'backup':
                result = backup(stack, args.destination)
            else:
                if args.action == 'start': stack.start()
                if args.action == 'stop': stack.stop()
                result = stack.status()
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print subprocess stderr or environment-derived credentials.
        print(json.dumps({'state': 'FAILED', 'errorCode': str(error) if type(error) is RuntimeError else type(error).__name__}), file=sys.stderr)
        sys.exit(1)
