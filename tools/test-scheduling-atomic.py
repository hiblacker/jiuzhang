#!/usr/bin/env python3
"""Run scheduling transaction regressions on a uniquely owned PostgreSQL database."""
from importlib import import_module
from pathlib import Path
import os
import subprocess
import tempfile
import zipfile


def main():
    local = import_module('local-stack')
    os.chdir(local.ROOT)
    with tempfile.TemporaryDirectory(prefix='scheduling-atomic-', dir=local.LOCAL) as directory:
        with zipfile.ZipFile('apps/worker/target/worker-0.1.0-SNAPSHOT.jar') as archive:
            for item in archive.infolist():
                if item.filename.startswith('BOOT-INF/lib/') and item.filename.endswith('.jar'):
                    (Path(directory) / Path(item.filename).name).write_bytes(archive.read(item))
        classpath = os.pathsep.join([str(local.ROOT/'apps/worker/target/classes'),
                                    str(local.ROOT/'modules/platform/target/classes'), directory+'/*'])
        subprocess.run(['java', '-cp', classpath, 'tools/java/SchedulingAtomicAcceptance.java'],
                       check=True, env=local.environment(), timeout=90)


if __name__ == '__main__':
    main()
