"""Opt-in macOS ENOSPC test on a new 16 MB image, never on the host volume."""
import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--output-root', required=True)
parser.add_argument('--parser-python', required=True)
args = parser.parse_args()
assert sys.platform == 'darwin'
root = Path(tempfile.mkdtemp(prefix='lake-enospc-', dir=args.output_root)).resolve()
mount = root / 'mount'; mount.mkdir()
image = root / 'fault.dmg'
subprocess.run(['hdiutil', 'create', '-size', '16m', '-fs', 'HFS+', '-type', 'UDIF', '-volname', 'JiuzhangFault', str(image)], check=True, capture_output=True)
attached = subprocess.run(['hdiutil', 'attach', '-nobrowse', '-mountpoint', str(mount), '-plist', str(image)], check=True, capture_output=True)
info = plistlib.loads(attached.stdout)
assert any(item.get('mount-point') == str(mount) for item in info['system-entities'])
assert mount.stat().st_dev != root.stat().st_dev, 'Refuse to fill the host volume'
try:
    inbox = root / 'inbox'; inbox.mkdir(); (inbox / 'data.csv').write_text('id\n001\n')
    lake = mount / 'lake'
    command = [shutil.which('node'), 'tools/file-ingest.mjs', '--inbox', str(inbox), '--lake-root', str(lake), '--source-code', 'synthetic', '--assume-ready', '--parser-python', args.parser_python]
    baseline = subprocess.run([*command, '--batch-id', 'baseline'], check=True, capture_output=True, text=True)
    assert json.loads(baseline.stdout)['state'] == 'COMPLETE'
    manifest = lake / 'file-batches/baseline/batch.json'
    original = manifest.read_bytes()
    raw = lake / json.loads(original)['entries'][0]['rawPath']
    raw_hash = hashlib.sha256(raw.read_bytes()).hexdigest()
    exhausted = False
    with (mount / 'filler').open('wb', buffering=0) as stream:
        try:
            while True: stream.write(bytes(65536))
        except OSError as error:
            assert error.errno == errno.ENOSPC; exhausted = True
    assert exhausted
    failed = subprocess.run([*command, '--batch-id', 'no-space'], capture_output=True, text=True)
    assert failed.returncode != 0
    assert 'ENOSPC' in failed.stderr or 'ENOSPC' in failed.stdout
    assert manifest.read_bytes() == original and hashlib.sha256(raw.read_bytes()).hexdigest() == raw_hash
    assert not (lake / 'file-batches/no-space/batch.json').exists()
    evidence = {'state': 'PASS', 'actualError': 'ENOSPC', 'isolatedImageMB': 16, 'failedRunNotCommitted': True, 'priorRawAndManifestUnchanged': True}
    (root / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence))
finally:
    subprocess.run(['hdiutil', 'detach', str(mount)], check=True, capture_output=True)
