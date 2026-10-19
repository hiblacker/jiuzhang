#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then bash tools/local-env.sh; fi
set -a
source .env
set +a
case "${1:-build}" in
  build) exec ./mvnw -B verify ;;
  migrate) exec java -Dloader.main=cn.jiuzhang.platform.migration.Migrate -cp apps/api/target/api-0.1.0-SNAPSHOT.jar org.springframework.boot.loader.launch.PropertiesLauncher ;;
  api|worker)
    role="$1"
    mkdir -p .local/runtime
    runtime=$(mktemp ".local/runtime/$role-XXXXXXXX.jar")
    cp "apps/$role/target/$role-0.1.0-SNAPSHOT.jar" "$runtime"
    exec java -jar "$runtime" ;;

  *) printf "Usage: bash tools/backend.sh build|migrate|api|worker\n" >&2; exit 2 ;;
esac
