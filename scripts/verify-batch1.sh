#!/usr/bin/env bash
# verify-batch1.sh — Tier0 M8 第一批核心验收（真实联调）
#
# 对运行中的真实服务跑：
#   zeus      http://127.0.0.1:3020
#   commerce  http://127.0.0.1:3021
#   ops-console SSR http://127.0.0.1:3022
#
# 覆盖 CONTRACT §5 第 1/2/4/5 条：
#   未登录 401/302；operator 改阈值 403；operator 审批 D3 403；
#   owner 审批 D3 成功且与 zeus 真实返回一致；operator 可批 D1 且 approver 注入；
#   看板数字与 commerce 逐字段一致。
#
# 用法： bash scripts/verify-batch1.sh
# 注意：JSON body 一律用 printf 构造，避免 bash 对 {...,...} 做大括号展开。
set -u

cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

OPS="${OPS_BASE_URL:-http://127.0.0.1:3022}"
ZEUS="${ZEUS_BASE_URL:-http://127.0.0.1:3020}"
COMMERCE="${COMMERCE_BASE_URL:-http://127.0.0.1:3021}"
ZEUS_TOKEN="${ZEUS_INTERNAL_TOKEN:-local-zeus-token}"
COMMERCE_TOKEN="${COMMERCE_API_TOKEN:-local-commerce-token}"

PASS=0; FAIL=0
say()  { printf '%-58s %s\n' "$1" "$2"; }
check() { # name expected actual
  if [ "$2" = "$3" ]; then say "$1" "PASS($3)"; PASS=$((PASS+1));
  else say "$1" "FAIL(expected=$2 got=$3)"; FAIL=$((FAIL+1)); fi
}

json_field() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
# curl JSON POST with auth header + bearer; echoes body
post_json() { # url bearer(- or token) json
  curl -s -X POST -H 'Content-Type: application/json' ${2:+-H "Authorization: Bearer $2"} -d "$3" "$1"
}

OWNER_JAR="$(mktemp)"; OP_JAR="$(mktemp)"
trap 'rm -f "$OWNER_JAR" "$OP_JAR"' EXIT

echo "== 0. 三个真实服务可达性 =="
check "zeus /healthz 200"        200 "$(curl -s -o /dev/null -w '%{http_code}' "$ZEUS/healthz")"
check "commerce /healthz 200"    200 "$(curl -s -o /dev/null -w '%{http_code}' "$COMMERCE/healthz")"
check "ops-console /healthz 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$OPS/healthz")"

echo "== 1. 未登录：API 401 / 页面 302 =="
check "未登录 GET /api/approvals"     401 "$(curl -s -o /dev/null -w '%{http_code}' "$OPS/api/approvals")"
check "未登录 GET /api/policy"       401 "$(curl -s -o /dev/null -w '%{http_code}' "$OPS/api/policy")"
check "未登录 GET /app/approvals"    302 "$(curl -s -o /dev/null -w '%{http_code}' "$OPS/app/approvals")"

echo "== 2. 登录 =="
LOGIN_BODY=$(printf '{"username":"%s","password":"%s"}' "$OPS_OWNER_USERNAME" "$OPS_OWNER_PASSWORD")
check "owner 登录 200" 200 "$(curl -s -c "$OWNER_JAR" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$LOGIN_BODY" "$OPS/api/auth/login")"
LOGIN_BODY=$(printf '{"username":"%s","password":"%s"}' "$OPS_OPERATOR_USERNAME" "$OPS_OPERATOR_PASSWORD")
check "operator 登录 200" 200 "$(curl -s -c "$OP_JAR" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$LOGIN_BODY" "$OPS/api/auth/login")"

echo "== 3. operator 改阈值 -> 403 FORBIDDEN =="
THR_BODY='{"d1MaxAmount":500}'
RESP=$(curl -s -b "$OP_JAR" -w '\n%{http_code}' -X PUT -H 'Content-Type: application/json' -d "$THR_BODY" "$OPS/api/policy/thresholds")
CODE=$(printf '%s' "$RESP" | tail -n1)
BODY=$(printf '%s' "$RESP" | sed '$d')
check "operator PUT /api/policy/thresholds" 403 "$CODE"
printf '%s' "$BODY" | grep -q '"code":"FORBIDDEN"' && say "      错误体含 FORBIDDEN" "PASS" && PASS=$((PASS+1)) || { say "      错误体含 FORBIDDEN" "FAIL"; FAIL=$((FAIL+1)); }

echo "== 4. 造 D3 决策（zeus 直接生成：impact=external + amount 超阈） =="
SUFFIX=$(date +%s)
D3_BODY=$(printf '{"intent":"verify-d3-%s","domain":"refund","amount":{"value":9999,"currency":"CNY"},"impact":"external","reversibility":"irreversible","idempotencyKey":"verify-d3-%s"}' "$SUFFIX" "$SUFFIX")
D3_RESP=$(post_json "$ZEUS/api/v1/decisions" "$ZEUS_TOKEN" "$D3_BODY")
D3ID=$(printf '%s' "$D3_RESP" | json_field "d['decisionId']")
check "zeus 造决策 grade=D3"     D3 "$(printf '%s' "$D3_RESP" | json_field "d['grade']")"
check "zeus 造决策 status=blocked" blocked "$(printf '%s' "$D3_RESP" | json_field "d['status']")"

echo "== 5. operator 审批 D3 -> 403（服务端强制，非仅前端禁用） =="
APPROVE_BODY='{"decision":"approve","comment":"should-fail"}'
CODE=$(curl -s -b "$OP_JAR" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$APPROVE_BODY" "$OPS/api/approvals/$D3ID/decision")
check "operator POST D3 /decision" 403 "$CODE"

echo "== 6. owner 审批 D3 -> 200，且与 zeus 真实状态一致（透传） =="
APPROVE_BODY='{"decision":"approve","comment":"verify-batch1"}'
OP_RESP=$(curl -s -b "$OWNER_JAR" -X POST -H 'Content-Type: application/json' -d "$APPROVE_BODY" "$OPS/api/approvals/$D3ID/decision")
check "控制台返回 status=decided" decided "$(printf '%s' "$OP_RESP" | json_field "d['status']")"
check "控制台返回 grade=D3"        D3      "$(printf '%s' "$OP_RESP" | json_field "d['grade']")"
ZEUS_REAL=$(curl -s -H "Authorization: Bearer $ZEUS_TOKEN" "$ZEUS/api/v1/decisions/$D3ID")
check "zeus 真实 status=decided" decided "$(printf '%s' "$ZEUS_REAL" | json_field "d['status']")"
check "zeus 真实 approver=owner" "$OPS_OWNER_USERNAME" "$(printf '%s' "$ZEUS_REAL" | json_field "d['approvals'][0]['approver']")"

echo "== 7. operator 审批 D1 -> 200，approver 注入 =="
D1_BODY=$(printf '{"intent":"verify-d1-%s","domain":"content","amount":{"value":100,"currency":"CNY"},"impact":"self","reversibility":"reversible","idempotencyKey":"verify-d1-%s"}' "$SUFFIX" "$SUFFIX")
D1_RESP=$(post_json "$ZEUS/api/v1/decisions" "$ZEUS_TOKEN" "$D1_BODY")
D1ID=$(printf '%s' "$D1_RESP" | json_field "d['decisionId']")
check "zeus 造决策 grade=D1" D1 "$(printf '%s' "$D1_RESP" | json_field "d['grade']")"
APPROVE_BODY='{"decision":"approve","comment":"operator-ok"}'
D1_OP=$(curl -s -b "$OP_JAR" -X POST -H 'Content-Type: application/json' -d "$APPROVE_BODY" "$OPS/api/approvals/$D1ID/decision")
check "operator 批 D1 status=decided" decided "$(printf '%s' "$D1_OP" | json_field "d['status']")"
D1_REAL=$(curl -s -H "Authorization: Bearer $ZEUS_TOKEN" "$ZEUS/api/v1/decisions/$D1ID")
check "zeus 真实 approver=operator" "$OPS_OPERATOR_USERNAME" "$(printf '%s' "$D1_REAL" | json_field "d['approvals'][0]['approver']")"

echo "== 8. 看板数字与 commerce 逐字段一致 =="
RAW=$(curl -s -H "Authorization: Bearer $COMMERCE_TOKEN" "$COMMERCE/api/v1/dashboard")
HTML=$(curl -s -b "$OWNER_JAR" "$OPS/app/dashboard")
for field in "d['metrics']['orders']['total']" "d['metrics']['orders']['paid']" "d['metrics']['orders']['completed']" \
             "d['metrics']['orders']['grossAmount']" "d['metrics']['refunds']['total']" "d['metrics']['refunds']['succeeded']" \
             "d['metrics']['refunds']['refundedAmount']" "d['metrics']['content']['published']" "d['metrics']['netAmount']"; do
  VAL=$(printf '%s' "$RAW" | json_field "$field")
  if printf '%s' "$HTML" | grep -qF "$VAL"; then say "看板含 $field = $VAL" "PASS" && PASS=$((PASS+1));
  else say "看板含 $field = $VAL" "FAIL(HTML 未出现)" && FAIL=$((FAIL+1)); fi
done

echo
echo "========================================"
echo " verify-batch1 结果: PASS=$PASS FAIL=$FAIL"
echo "========================================"
[ "$FAIL" -eq 0 ]
