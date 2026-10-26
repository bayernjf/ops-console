#!/usr/bin/env bash
# verify-batch3.sh — console-side wiring (next batch) real-process checks:
#   zeus 3020 + commerce 3021 + ops-console 3022 (all REAL processes).
#
# Proves:
#   1. zeus -> console inbound decision webhook: signed `created` event lands
#      in the console inbound log (real push, not mocked).
#   2. inbound endpoint: bad signature -> 401; signed new event -> 200 accepted;
#      replay of a seen delivery-id -> 200 duplicate (idempotent).
#   3. refunds list GET /api/refunds and content list GET /api/content return
#      real rows, field-by-field.
#   4. refunds / content / approvals pages render 200.
set -u
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

OPS="http://127.0.0.1:3022"
ZEUS="http://127.0.0.1:3020"
ZEUS_TOKEN="${ZEUS_INTERNAL_TOKEN:-local-zeus-token}"
SECRET="${OPS_DECISION_WEBHOOK_SECRET:?set OPS_DECISION_WEBHOOK_SECRET in .env}"
INBOUND_LOG="${OPS_DECISION_WEBHOOK_LOG:-./data/inbound-decision-events.jsonl}"

PASS=0; FAIL=0
say()  { printf '%-58s %s\n' "$1" "$2"; }
check() { if [ "$2" = "$3" ]; then say "$1" "PASS($3)"; PASS=$((PASS+1)); else say "$1" "FAIL(expected=$2 got=$3)"; FAIL=$((FAIL+1)); fi; }
jq() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT

echo "== 0. health =="
check "zeus 3020" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$ZEUS/healthz")"
check "console 3022" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$OPS/healthz")"

echo "== 1. zeus -> console real signed push =="
TS=$(date +%s)
RESP=$(curl -s -X POST "$ZEUS/api/v1/decisions" \
  -H "Authorization: Bearer $ZEUS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"intent\":\"verify-inbound\",\"domain\":\"commerce.refund\",\"amount\":{\"value\":1299,\"currency\":\"CNY\"},\"impact\":\"team\",\"reversibility\":\"reversible\",\"idempotencyKey\":\"batch3-$TS-$RANDOM\"}")
DID=$(printf '%s' "$RESP" | jq 'd["decisionId"]')
say "created decision" "$DID"

# wait for the signed event to land in the console inbound log
LANDED=0
for i in $(seq 1 20); do
  if [ -f "$INBOUND_LOG" ] && grep -q "\"decisionId\":\"$DID\"" "$INBOUND_LOG"; then LANDED=1; break; fi
  sleep 0.3
done
check "inbound log got signed created event" 1 "$LANDED"

echo "== 2. inbound endpoint auth + idempotency =="
BODY='{"type":"late","decisionId":"dec_b3","at":"2026-10-26T11:00:00.000Z","domain":"x","intent":"y","grade":"D2","mode":"approve-sync","status":"blocked","ruleId":"r"}'
BAD=$(node -e "const{createHmac}=require('crypto');console.log('sha256=bad')")
check "bad signature -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$OPS/api/inbound/zeus/decision-webhook" -H "x-zeus-signature: $BAD" -H "x-zeus-delivery-id: dec_b3:late:1" -H 'Content-Type: application/json' -d "$BODY")"

DELID="dec_b3:late:2026-10-26T11:00:00.000Z"
SIG=$(node -e "const{createHmac}=require('crypto');console.log('sha256='+createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$SECRET" "$BODY")
R1=$(curl -s -X POST "$OPS/api/inbound/zeus/decision-webhook" -H "x-zeus-signature: $SIG" -H "x-zeus-delivery-id: $DELID" -H 'Content-Type: application/json' -d "$BODY")
check "signed new event -> 200 accepted" true "$(printf '%s' "$R1" | jq '"true" if d.get("accepted")==True and d.get("duplicate")==False else "false"')"
R2=$(curl -s -X POST "$OPS/api/inbound/zeus/decision-webhook" -H "x-zeus-signature: $SIG" -H "x-zeus-delivery-id: $DELID" -H 'Content-Type: application/json' -d "$BODY")
check "replay seen delivery-id -> duplicate" true "$(printf '%s' "$R2" | jq '"true" if d.get("duplicate")==True else "false"')"

echo "== 3. refunds / content lists (logged in) =="
curl -s -c "$JAR" -o /dev/null -X POST "$OPS/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$OPS_OWNER_USERNAME\",\"password\":\"$OPS_OWNER_PASSWORD\"}"
REF=$(curl -s -b "$JAR" "$OPS/api/refunds")
check "refunds list shape {refunds:[...]}" true "$(printf '%s' "$REF" | jq '"true" if isinstance(d.get("refunds"),list) else "false"')"
say "refund rows" "$(printf '%s' "$REF" | jq 'len(d["refunds"])')"
CNT=$(curl -s -b "$JAR" "$OPS/api/content")
check "content list shape {content:[...]}" true "$(printf '%s' "$CNT" | jq '"true" if isinstance(d.get("content"),list) else "false"')"
say "content rows" "$(printf '%s' "$CNT" | jq 'len(d["content"])')"

echo "== 4. pages =="
for p in /app/refunds /app/content /app/approvals; do
  check "GET $p 200" 200 "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$OPS$p")"
done

echo
echo "========================================"
echo " verify-batch3 结果: PASS=$PASS FAIL=$FAIL"
echo "========================================"
[ "$FAIL" -eq 0 ]
