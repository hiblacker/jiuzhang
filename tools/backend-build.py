#!/usr/bin/env python3
"""Verify that local backend artifacts match their current build inputs."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ROLES = ('api', 'worker')
INPUTS = ('pom.xml', '.mvn/wrapper', 'mvnw', 'modules/platform/pom.xml',
          'modules/platform/src', 'apps/api/pom.xml', 'apps/api/src',
          'apps/worker/pom.xml', 'apps/worker/src', 'infra/migrations/postgresql',
          'tools/backend.sh', 'tools/backend-build.py')
REBUILD = 'Stop the applications, then run bash tools/local.sh up to rebuild and migrate.'


def fingerprint():
    digest = hashlib.sha256()
    for name in INPUTS:
        path = ROOT / name
        files = sorted(path.rglob('*')) if path.is_dir() else [path]
        for file in files:
            if file.is_file():
                digest.update(file.relative_to(ROOT).as_posix().encode())
                digest.update(bytes([0]))
                digest.update(file.read_bytes())
                digest.update(bytes([0]))
    return digest.hexdigest()


def artifact(role):
    return ROOT / 'apps' / role / 'target' / (role + '-0.1.0-SNAPSHOT.jar')


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def record(expected):
    artifacts = {role: checksum(artifact(role)) for role in ROLES}
    if fingerprint() != expected:
        raise RuntimeError('Backend inputs changed during the build. ' + REBUILD)
    state = ROOT / '.local/backend-build.json'
    state.parent.mkdir(exist_ok=True)
    state.write_text(json.dumps({'inputs': expected, 'artifacts': artifacts}))


def check(role):
    try:
        state = json.loads((ROOT / '.local/backend-build.json').read_text())
        current = checksum(artifact(role))
        valid = state['inputs'] == fingerprint() and state['artifacts'][role] == current
    except (OSError, ValueError, KeyError, TypeError):
        valid = False
    if not valid:
        raise RuntimeError('Backend build is missing or stale. ' + REBUILD)
    return current


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['build', 'check'])
    parser.add_argument('role', nargs='?', choices=ROLES)
    args = parser.parse_args()
    if args.action == 'build':
        before = fingerprint()
        subprocess.run(['./mvnw', '-B', 'verify'], cwd=ROOT, check=True)
        record(before)
    else:
        if args.role is None:
            parser.error('check requires a role')
        check(args.role)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print('Backend startup failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
