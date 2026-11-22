#!/usr/bin/env bash
# Build and publish Ruta viva to ~/docker/rutaviva (https://rutaviva.aminox.dev).
#   ./deploy.sh          site + nginx config
#   ./deploy.sh worker   also rebuild and restart the worker image
set -euo pipefail
cd "$(dirname "$0")"
TARGET="${RUTAVIVA_DEPLOY_DIR:-$HOME/docker/rutaviva}"

npm run build
test "$(find dist/carretera -name index.html | wc -l)" -ge 50 || { echo "faltan páginas de carreteras" >&2; exit 1; }
! grep -rl '{{' dist --include=index.html | head -1 | grep -q . || { echo "plantilla sin rellenar" >&2; exit 1; }
rsync -a --delete dist/ "$TARGET/data/html/"

if [ "${1:-}" = worker ]; then
  (cd worker && .venv/bin/python -m pytest -q tests)
  docker build -q -t "rutaviva-worker:$(git rev-parse --short HEAD 2>/dev/null || date +%s)" -t rutaviva-worker:current worker
fi

changed=0
for f in nginx.conf compose.yaml; do
  if ! cmp -s "deploy/$f" "$TARGET/$f"; then cp "deploy/$f" "$TARGET/$f"; changed=1; fi
done
(cd "$TARGET" && docker compose up -d --remove-orphans)
if [ "$changed" = 1 ]; then
  docker exec rutaviva nginx -t && docker exec rutaviva nginx -s reload && echo "nginx recargado"
fi
echo "Publicado en $TARGET"
