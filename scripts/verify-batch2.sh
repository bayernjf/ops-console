#!/usr/bin/env bash
# verify-batch2.sh — Tier0 M8 第二批受控写真实闭环（3020/3021/3022）
#
# seed -> 新建商品(operator) -> 提交上架(423 D3) -> operator 上架审批 403
#      -> owner 上架审批 -> listed -> 拉单(幂等) -> 库存调整
#      -> 发起退款(423 D2) -> operator 退款审批 -> succeeded
# JSON body 一律 printf 构造，避免 bash 大括号展开吞逗号。
set -u
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

OPS="http://127.0.0.1:3022"
COMMERCE="${COMMERCE_BASE_URL:-http://127.0.0.1:3021}"
COMMERCE_TOKEN="${COMMERCE_API_TOKEN:-local-commerce-token}"

PASS=0; FAIL=0
say()  { printf '%-58s %s\n' "$1" "$2"; }
check() { if [ "$2" = "$3" ]; then say "$1" "PASS($3)"; PASS=$((PASS+1)); else say "$1" "FAIL(expected=$2 got=$3)"; FAIL=$((FAIL+1)); fi; }
jq() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

OWNER_JAR=$(mktemp); OP_JAR=$(mktemp)
trap 'rm -f "$OWNER_JAR" "$OP_JAR"' EXIT

echo "== 0. seed（幂等） =="
bash scripts/seed-dev.sh

echo "== 1. 登录 =="
LOGIN=$(printf '{"username":"%s","password":"%s"}' "$OPS_OWNER_USERNAME" "$OPS_OWNER_PASSWORD")
check "owner 登录 200" 200 "$(curl -s -c "$OWNER_JAR" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$LOGIN" "$OPS/api/auth/login")"
LOGIN=$(printf '{"username":"%s","password":"%s"}' "$OPS_OPERATOR_USERNAME" "$OPS_OPERATOR_PASSWORD")
check "operator 登录 200" 200 "$(curl -s -c "$OP_JAR" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$LOGIN" "$OPS/api/auth/login")"

# 取渠道账号
ACC_ID=$(curl -s -H "Authorization: Bearer $COMMERCE_TOKEN" "$COMMERCE/api/v1/channel-accounts" | jq 'd["accounts"][0]["id"]')
say "渠道账号" "$ACC_ID"

echo "== 2. operator 新建商品 =="
SKU="SKU-V2-$(date +%s)"
BODY=$(printf '{"title":"第二批验证商品","channelAccountId":"%s","skus":[{"skuCode":"%s","price":1299,"currency":"CNY"}]}' "$ACC_ID" "$SKU")
RESP=$(curl -s -b "$OP_JAR" -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "$BODY" "$OPS/api/products")
check "operator 建商品 201" 201 "$(printf '%s' "$RESP" | tail -n1)"
PID=$(printf '%s' "$RESP" | sed '$d' | jq 'd["product"]["id"]')
say "新建商品" "$PID"

echo "== 3. operator 提交上架（423 D3 挂起） =="
BODY=$(printf '{"productId":"%s","channelAccountId":"%s","contentType":"detail","sellingPoints":["验证卖点"]}' "$PID" "$ACC_ID")
RESP=$(curl -s -b "$OP_JAR" -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "$BODY" "$OPS/api/listings")
check "提交上架 423 挂起" 423 "$(printf '%s' "$RESP" | tail -n1)"
DEC_ID=$(printf '%s' "$RESP" | sed '$d' | jq 'd["submission"]["decisionId"]')
check "挂起 grade=D3" D3 "$(printf '%s' "$RESP" | sed '$d' | jq 'd["submission"]["grade"]')"
say "挂起 decisionId" "$DEC_ID"

echo "== 4. operator 上架审批 -> 403 =="
check "operator 批准上架 403" 403 "$(curl -s -b "$OP_JAR" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"comment":"x"}' "$OPS/api/listings/$DEC_ID/approve")"

echo "== 5. owner 上架审批 -> listed（commerce 真正发布到沙箱） =="
RESP=$(curl -s -b "$OWNER_JAR" -X POST -H 'Content-Type: application/json' -d '{"comment":"owner ok"}' "$OPS/api/listings/$DEC_ID/approve")
check "owner 批准上架 status=listed" listed "$(printf '%s' "$RESP" | jq 'd["submission"]["status"]')"
PSTATUS=$(curl -s -H "Authorization: Bearer $COMMERCE_TOKEN" "$COMMERCE/api/v1/products/$PID" | jq 'd["product"]["status"]')
check "commerce 商品状态=listed" listed "$PSTATUS"

echo "== 6. 拉单（operator，幂等） =="
BODY=$(printf '{"channelAccountId":"%s"}' "$ACC_ID")
R1=$(curl -s -b "$OP_JAR" -X POST -H 'Content-Type: application/json' -d "$BODY" "$OPS/api/orders/import")
N1=$(printf '%s' "$R1" | jq 'len(d["result"]["imported"])')
say "首次拉单新增" "$N1"
R2=$(curl -s -b "$OP_JAR" -X POST -H 'Content-Type: application/json' -d "$BODY" "$OPS/api/orders/import")
check "二次拉单幂等=0 新增" 0 "$(printf '%s' "$R2" | jq 'len(d["result"]["imported"])')"

echo "== 7. 库存手工调整（operator） =="
SKU_ID=$(curl -s -H "Authorization: Bearer $COMMERCE_TOKEN" "$COMMERCE/api/v1/products/$PID" | jq 'd["product"]["skus"][0]["id"]')
BODY=$(printf '{"skuId":"%s","qty":50}' "$SKU_ID")
RESP=$(curl -s -b "$OP_JAR" -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "$BODY" "$OPS/api/inventory")
check "库存调整 201" 201 "$(printf '%s' "$RESP" | tail -n1)"
check "库存 qtyAvailable=50" 50 "$(printf '%s' "$RESP" | sed '$d' | jq 'd["inventory"]["qtyAvailable"]')"

echo "== 8. operator 发起退款（423 D2 挂起） =="
ORDER_ID=$(curl -s -H "Authorization: Bearer $COMMERCE_TOKEN" "$COMMERCE/api/v1/orders" | jq 'd["orders"][0]["id"]')
LINE_ID=$(curl -s -H "Authorization: Bearer $COMMERCE_TOKEN" "$COMMERCE/api/v1/orders/$ORDER_ID" | jq 'd["order"]["lines"][0]["id"]')
BODY=$(printf '{"orderId":"%s","lines":[{"orderItemId":"%s"}],"reason":"第二批验证退款"}' "$ORDER_ID" "$LINE_ID")
RESP=$(curl -s -b "$OP_JAR" -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "$BODY" "$OPS/api/refunds")
check "发起退款 423 挂起" 423 "$(printf '%s' "$RESP" | tail -n1)"
REF_ID=$(printf '%s' "$RESP" | sed '$d' | jq 'd["refund"]["id"]')
say "退款单" "$REF_ID"

echo "== 9. operator 审批退款（D2 两角色均可）-> succeeded =="
RESP=$(curl -s -b "$OP_JAR" -X POST -H 'Content-Type: application/json' -d '{"verdict":"approve","comment":"operator ok"}' "$OPS/api/refunds/$REF_ID/decision")
check "operator 批退款 refund.status=succeeded" succeeded "$(printf '%s' "$RESP" | jq 'd["refund"]["status"]')"

echo "== 10. 只读页面/接口冒烟 =="
check "GET /api/products 200" 200 "$(curl -s -b "$OWNER_JAR" -o /dev/null -w '%{http_code}' "$OPS/api/products")"
check "GET /api/orders 200"   200 "$(curl -s -b "$OWNER_JAR" -o /dev/null -w '%{http_code}' "$OPS/api/orders")"
check "GET /api/inventory 200" 200 "$(curl -s -b "$OWNER_JAR" -o /dev/null -w '%{http_code}' "$OPS/api/inventory")"
check "GET /app/products 200" 200 "$(curl -s -b "$OWNER_JAR" -o /dev/null -w '%{http_code}' "$OPS/app/products")"
check "GET /app/orders 200"  200 "$(curl -s -b "$OWNER_JAR" -o /dev/null -w '%{http_code}' "$OPS/app/orders")"
check "GET /app/refunds 200"   200 "$(curl -s -b "$OWNER_JAR" -o /dev/null -w '%{http_code}' "$OPS/app/refunds")"
check "GET /app/inventory 200" 200 "$(curl -s -b "$OWNER_JAR" -o /dev/null -w '%{http_code}' "$OPS/app/inventory")"
check "GET /app/content 200"  200 "$(curl -s -b "$OWNER_JAR" -o /dev/null -w '%{http_code}' "$OPS/app/content")"

echo
echo "========================================"
echo " verify-batch2 结果: PASS=$PASS FAIL=$FAIL"
echo "========================================"
[ "$FAIL" -eq 0 ]
