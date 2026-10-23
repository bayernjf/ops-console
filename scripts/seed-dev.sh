#!/usr/bin/env bash
# seed-dev.sh — 幂等初始化 commerce 开发数据（直连 commerce:3021）。
# 只创建：沙箱渠道账号 + 演示商品。已存在则跳过。
# 渠道账号创建是本地开发行为，不做成控制台功能。
set -u
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

COMMERCE="${COMMERCE_BASE_URL:-http://127.0.0.1:3021}"
TOKEN="${COMMERCE_API_TOKEN:-local-commerce-token}"
AUTH="Authorization: Bearer $TOKEN"

say() { printf '%-56s %s\n' "$1" "$2"; }

# 1. 沙箱渠道账号（channel=sandbox-douyin）
EXISTING_ID=$(curl -s -H "$AUTH" "$COMMERCE/api/v1/channel-accounts" \
  | python3 -c 'import sys,json;accs=json.load(sys.stdin)["accounts"];m=[a for a in accs if a["channel"]=="sandbox-douyin"];print(m[0]["id"] if m else "")')
if [ -n "$EXISTING_ID" ]; then
  say "渠道账号 sandbox-douyin 已存在" "SKIP(id=$EXISTING_ID)"
else
  RESP=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
    -d '{"channel":"sandbox-douyin","displayName":"沙箱抖店"}' "$COMMERCE/api/v1/channel-accounts")
  EXISTING_ID=$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["account"]["id"])')
  say "创建渠道账号 sandbox-douyin" "OK(id=$EXISTING_ID)"
fi

# 2. 演示商品（skuCode=SKU-DEMO-001）
HAS_SKU=$(curl -s -H "$AUTH" "$COMMERCE/api/v1/products" \
  | python3 -c 'import sys,json;ps=json.load(sys.stdin)["products"];print("yes" if any(s.get("skuCode")=="SKU-DEMO-001" for p in ps for s in p.get("skus",[])) else "")')
if [ "$HAS_SKU" = "yes" ]; then
  say "演示商品 SKU-DEMO-001 已存在" "SKIP"
else
  BODY=$(printf '{"title":"演示商品 标准款","channelAccountId":"%s","attributes":{"brand":"演示"},"skus":[{"skuCode":"SKU-DEMO-001","specs":{"model":"standard"},"price":1299,"currency":"CNY"}]}' "$EXISTING_ID")
  RESP=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "$BODY" "$COMMERCE/api/v1/products")
  PID=$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["product"]["id"])')
  say "创建演示商品 SKU-DEMO-001" "OK(product=$PID)"
fi
echo "seed-dev 完成。"
