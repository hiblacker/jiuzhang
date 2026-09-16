"""Build the pinned local product images; never replace an existing image tag."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--api-tag', default='0.2.0-dev.2')
parser.add_argument('--worker-tag', default='0.2.0-dev.2')
parser.add_argument('--online-maven', action='store_true', help='Allow the configured Aliyun mirror; offline by default')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
artifacts = repo / 'deploy/artifacts'
artifacts.mkdir(exist_ok=True)

def run(command):
    subprocess.run(command, cwd=repo, check=True)

images = {'api': 'jiuzhang/control-api:' + args.api_tag, 'worker': 'jiuzhang/product-worker:' + args.worker_tag}
for image in images.values():
    if subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        raise SystemExit('IMAGE_TAG_ALREADY_EXISTS: choose new tags and update Compose')
lock = json.loads((repo / 'deploy/product-runtime-lock.json').read_text())
wheels = artifacts / 'linux-wheels'
wheels.mkdir(exist_ok=True)
missing = any(not (wheels / item['wheel']).exists() for item in lock['wheels'])
if missing:
    run([sys.executable, '-m', 'pip', 'download', '--index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple',
         '--only-binary=:all:', '--no-deps', '--require-hashes', '--python-version', '312', '--implementation', 'cp',
         '--abi', 'cp312', '--platform', 'manylinux_2_28_x86_64', '--platform', 'manylinux2014_x86_64',
         '--dest', str(wheels), '-r', 'deploy/product-requirements.txt'])
for item in lock['wheels']:
    if hashlib.sha256((wheels / item['wheel']).read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('WHEEL_HASH_MISMATCH: ' + item['name'])
run(['npm', 'ci', '--prefix', 'apps/console', '--registry=https://registry.npmmirror.com', '--ignore-scripts'])
run(['npm', 'run', 'build', '--prefix', 'apps/console'])
run(['mvn', *([] if args.online_maven else ['-o']), '-q', '-s', 'deploy/maven-settings.xml',
     '-f', 'apps/control-api/pom.xml', '-DskipTests', 'package'])
shutil.copyfile(repo / 'apps/control-api/target/control-api-0.1.0-SNAPSHOT.jar', artifacts / 'control-api.jar')
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
run(['git', 'bundle', 'create', str(artifacts / 'models.bundle'), 'HEAD'])
for name in ['api', 'worker']:
    run(['docker', 'build', '--platform', 'linux/amd64', '-f', 'deploy/Dockerfile.product-' + name,
         '-t', images[name], '.'])
manifest = {'gitRevision': revision, 'workingTreeDirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=repo)),
            'images': images, 'target': 'linux/amd64', 'wheelCount': len(lock['wheels']),
            'jarSha256': hashlib.sha256((artifacts / 'control-api.jar').read_bytes()).hexdigest()}
(artifacts / 'build.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest))
