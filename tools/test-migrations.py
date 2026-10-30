#!/usr/bin/env python3
"""Validate empty/upgrade/repeated migrations against the configured PostgreSQL endpoint."""
from importlib import import_module
from pathlib import Path
import os
import subprocess
import tempfile
import zipfile


def main():
    local = import_module('local-stack')
    os.chdir(local.ROOT)
    with tempfile.TemporaryDirectory(prefix='migration-', dir=local.LOCAL) as directory:
        with zipfile.ZipFile('apps/api/target/api-0.1.0-SNAPSHOT.jar') as archive:
            for item in archive.infolist():
                if item.filename.startswith('BOOT-INF/lib/') and item.filename.endswith('.jar'):
                    (Path(directory) / Path(item.filename).name).write_bytes(archive.read(item))
        classpath = str(local.ROOT / 'modules/platform/target/classes') + os.pathsep + directory + '/*'
        subprocess.run(['java', '-cp', classpath, 'tools/java/MigrationAcceptance.java'],
                       check=True, env=local.environment(), timeout=90)


if __name__ == '__main__':
    main()
