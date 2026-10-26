#!/usr/bin/env bash
# Start the two local upstream services ops-console aggregates against.
#
#   zeus      -> http://127.0.0.1:3020  (decision + org HTTP API v1)
#   commerce  -> http://127.0.0.1:3021  (commerce-os API + dashboard)
#
# Both run from the sibling repos /Users/jiangfeng/000mycodes/{zeus,commerce-os}
# using their committed `dist/` builds. Run `npm run build` in each repo first if
# dist is stale. Data is kept under ./data/dev-upstream and is safe to delete.
#
# Usage:
#   bash scripts/dev-upstream.sh          start both (foreground logs in data/)
#   bash scripts/dev-upstream.sh stop     stop both
#   bash scripts/dev-upstream.sh status   report health
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data/dev-upstream"
mkdir -p "$DATA_DIR"

ZEUS_DIR="${ZEUS_DIR:-/Users/jiangfeng/000mycodes/zeus}"
COMMERCE_DIR="${COMMERCE_DIR:-/Users/jiangfeng/000mycodes/commerce-os}"
ZEUS_PORT=3020
COMMERCE_PORT=3021
ZEUS_TOKEN="${ZEUS_INTERNAL_TOKEN:-local-zeus-token}"
COMMERCE_TOKEN="${COMMERCE_API_TOKEN:-local-commerce-token}"

zeus_pid_file="$DATA_DIR/zeus.pid"
commerce_pid_file="$DATA_DIR/commerce.pid"

stop() {
  for f in "$zeus_pid_file" "$commerce_pid_file"; do
    if [ -f "$f" ]; then
      pid="$(cat "$f")"
      kill "$pid" 2>/dev/null || true
      rm -f "$f"
    fi
  done
}

status() {
  for pair in "zeus $ZEUS_PORT/healthz" "commerce $COMMERCE_PORT/healthz"; do
    set -- $pair
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$2" || true)"
    echo "$1 http://127.0.0.1:$2 -> ${code:-down}"
  done
}

case "${1:-start}" in
  stop)
    stop
    echo "upstream stopped"
    ;;
  status)
    status
    ;;
  start)
    : > "$DATA_DIR/zeus.log"
    : > "$DATA_DIR/commerce.log"
    (
      cd "$ZEUS_DIR"
      ZEUS_PORT="$ZEUS_PORT" ZEUS_HOST=127.0.0.1 \
      ZEUS_INTERNAL_TOKEN="$ZEUS_TOKEN" \
      ZEUS_DB_FILE="$DATA_DIR/zeus.db" \
      ZEUS_DECISION_WEBHOOK_URL="http://127.0.0.1:3022/api/inbound/zeus/decision-webhook" \
      ZEUS_DECISION_WEBHOOK_SECRET="${OPS_DECISION_WEBHOOK_SECRET:-local-decision-webhook-secret-change-me}" \
      node dist/http/serve.js >> "$DATA_DIR/zeus.log" 2>&1 &
      echo $! > "$zeus_pid_file"
    )
    (
      cd "$COMMERCE_DIR"
      COMMERCE_PORT="$COMMERCE_PORT" COMMERCE_HOST=127.0.0.1 \
      COMMERCE_SQLITE_PATH="$DATA_DIR/commerce.db" \
      ZEUS_BASE_URL="http://127.0.0.1:$ZEUS_PORT" \
      ZEUS_INTERNAL_TOKEN="$ZEUS_TOKEN" \
      COMMERCE_API_TOKEN="$COMMERCE_TOKEN" \
      node dist/serve.js >> "$DATA_DIR/commerce.log" 2>&1 &
      echo $! > "$commerce_pid_file"
    )
    sleep 4
    status
    echo "logs: $DATA_DIR/{zeus,commerce}.log"
    ;;
  *)
    echo "usage: $0 [start|stop|status]" >&2
    exit 2
    ;;
esac
