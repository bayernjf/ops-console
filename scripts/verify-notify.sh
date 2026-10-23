#!/usr/bin/env bash
# verify-notify.sh — end-to-end check against the REAL local services:
#   zeus 3020 + ops-console 3022 (Astro dev/standalone) + fake receiver 3023.
#
# What it proves (CONTRACT §3.3 / §5.6):
#   1. A newly created D2 decision is delivered as a pending webhook card ≤ 60s.
#   2. A newly created D3 decision likewise.
#   3. Repeated polls do NOT re-deliver (decisionId+event idempotency).
#   4. The card's deepLink reaches the console approvals page (logged-in GET 200).
#
# Timeout/escalation/channel-failure are covered by unit tests (injected clock
# and failure injection) — zeus 0.1.0 default policy sets no slaHours, so real
# D2/D3 decisions never carry timeoutAt; see handoff "kernel gaps".
set -u

ZEUS_URL="${ZEUS_BASE_URL:-http://127.0.0.1:3020}"
OPS_URL="${OPS_PUBLIC_BASE_URL:-http://127.0.0.1:3022}"
RECEIVER_URL="${OPS_NOTIFY_WEBHOOK_URL:-http://127.0.0.1:3023/hook}"
RECEIVER_ROOT="http://127.0.0.1:3023"
ZEUS_TOKEN="${ZEUS_INTERNAL_TOKEN:-local-zeus-token}"
OWNER_USER="${OPS_OWNER_USERNAME:-owner}"
OWNER_PASS="${OPS_OWNER_PASSWORD:-owner-change-me}"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d -t ops-verify-notify.XXXXXX)"
COOKIE_JAR="${TMP_DIR}/cookies.txt"
RECEIVER_LOG="${TMP_DIR}/receiver.log"
RECEIVER_PID=""
trap 'rm -rf "${TMP_DIR}"; [ -n "${RECEIVER_PID}" ] && kill "${RECEIVER_PID}" 2>/dev/null || true' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
info() { echo "== $*"; }

# --- 0. prerequisites -------------------------------------------------------
info "zeus health"
curl -fsS -m 3 "${ZEUS_URL}/healthz" >/dev/null || fail "zeus ${ZEUS_URL} not reachable"
info "ops-console health"
curl -fsS -m 3 "${OPS_URL}/healthz" >/dev/null || fail "ops-console ${OPS_URL} not reachable"

# --- 1. receiver -------------------------------------------------------------
# Always own the receiver for this run: free 3023, then start a clean one.
info "freeing port 3023 and starting fake webhook receiver"
EXISTING_PIDS="$(lsof -nP -iTCP:3023 -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -n "${EXISTING_PIDS}" ]; then
  # shellcheck disable=SC2086
  kill ${EXISTING_PIDS} 2>/dev/null || true
  sleep 0.5
fi
(
  cd "${REPO_DIR}"
  WEBHOOK_RECEIVER_PORT=3023 WEBHOOK_RECEIVER_FILE="${TMP_DIR}/received.jsonl" \
    nohup node scripts/fake-webhook-receiver.ts >"${RECEIVER_LOG}" 2>&1 &
  echo $! >"${TMP_DIR}/pid"
)
RECEIVER_PID="$(cat "${TMP_DIR}/pid")"
for i in $(seq 1 40); do
  curl -fsS -m 1 "${RECEIVER_ROOT}/healthz" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS -m 2 "${RECEIVER_ROOT}/healthz" >/dev/null || { cat "${RECEIVER_LOG}"; fail "receiver did not start"; }

# --- 2. login to console (for deep-link reachability check) ------------------
info "logging in as ${OWNER_USER}"
curl -fsS -m 5 -c "${COOKIE_JAR}" -X POST "${OPS_URL}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${OWNER_USER}\",\"password\":\"${OWNER_PASS}\"}" >/dev/null \
  || fail "console login failed"

# Warm a protected route so middleware runs startNotifyScheduler (login itself
# is a public route and would not start the poller).
info "warming protected route to start the notify poller"
curl -fsS -m 5 -b "${COOKIE_JAR}" "${OPS_URL}/api/notify/config" >/dev/null \
  || fail "could not reach /api/notify/config"
info "poller started; waiting 8s for its first tick"
sleep 8

# --- 3. create a real D2 and a real D3 decision in zeus ----------------------
TS="$(date +%s)"
D2_KEY="notify-verify-d2-${TS}-${RANDOM}"
D3_KEY="notify-verify-d3-${TS}-${RANDOM}"

info "creating D2 decision (idempotencyKey=${D2_KEY})"
D2_RESP="$(curl -fsS -m 5 -X POST "${ZEUS_URL}/api/v1/decisions" \
  -H "Authorization: Bearer ${ZEUS_TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"intent\":\"verify-refund\",\"domain\":\"commerce.refund\",\"amount\":{\"value\":1299,\"currency\":\"CNY\"},\"impact\":\"team\",\"reversibility\":\"reversible\",\"idempotencyKey\":\"${D2_KEY}\"}")" \
  || fail "D2 creation failed"
D2_ID="$(printf '%s' "${D2_RESP}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["decisionId"])')"
echo "   -> ${D2_ID} $(printf '%s' "${D2_RESP}")"

info "creating D3 decision (idempotencyKey=${D3_KEY})"
D3_RESP="$(curl -fsS -m 5 -X POST "${ZEUS_URL}/api/v1/decisions" \
  -H "Authorization: Bearer ${ZEUS_TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"intent\":\"verify-external-payout\",\"domain\":\"commerce.payout\",\"amount\":{\"value\":99,\"currency\":\"CNY\"},\"impact\":\"external\",\"reversibility\":\"reversible\",\"idempotencyKey\":\"${D3_KEY}\"}")" \
  || fail "D3 creation failed"
D3_ID="$(printf '%s' "${D3_RESP}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["decisionId"])')"
echo "   -> ${D3_ID} $(printf '%s' "${D3_RESP}")"

# --- 4. wait ≤60s for both cards --------------------------------------------
wait_for_card() {
  local id="$1"
  local i COUNT
  for i in $(seq 1 120); do
    COUNT="$(curl -fsS -m 2 "${RECEIVER_ROOT}/received?decisionId=${id}&event=pending" 2>/dev/null \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["count"])' 2>/dev/null || echo 0)"
    if [ "${COUNT}" -ge 1 ]; then
      echo "${i}"
      return 0
    fi
    sleep 0.5
  done
  echo 0
  return 1
}

info "waiting for D2 pending card (≤60s)"
D2_WAIT="$(wait_for_card "${D2_ID}")"
[ "${D2_WAIT}" != "0" ] || fail "D2 card not received within 60s"
info "D2 card received after ~$(python3 -c "print(${D2_WAIT}*0.5)")s"

info "waiting for D3 pending card (≤60s)"
D3_WAIT="$(wait_for_card "${D3_ID}")"
[ "${D3_WAIT}" != "0" ] || fail "D3 card not received within 60s"
info "D3 card received after ~$(python3 -c "print(${D3_WAIT}*0.5)")s"

# --- 5. idempotency: wait 12s, counts must not grow --------------------------
info "idempotency: sleeping 12s across extra polls"
sleep 12
D2_COUNT="$(curl -fsS -m 2 "${RECEIVER_ROOT}/received?decisionId=${D2_ID}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["count"])')"
D3_COUNT="$(curl -fsS -m 2 "${RECEIVER_ROOT}/received?decisionId=${D3_ID}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["count"])')"
echo "   D2 deliveries=${D2_COUNT}  D3 deliveries=${D3_COUNT}"
[ "${D2_COUNT}" = "1" ] || fail "D2 delivered ${D2_COUNT} times (expected 1)"
[ "${D3_COUNT}" = "1" ] || fail "D3 delivered ${D3_COUNT} times (expected 1)"

# --- 6. deepLink reachability ----------------------------------------------
DEEP_LINK="$(curl -fsS -m 2 "${RECEIVER_ROOT}/received?decisionId=${D2_ID}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["records"][0]["payload"]["deepLink"])')"
info "deepLink=${DEEP_LINK}"
LINK_STATUS="$(curl -fsS -m 5 -b "${COOKIE_JAR}" -o /dev/null -w '%{http_code}' "${DEEP_LINK}")"
echo "   logged-in GET deepLink -> HTTP ${LINK_STATUS}"
[ "${LINK_STATUS}" = "200" ] || fail "deepLink returned HTTP ${LINK_STATUS}"

# --- 7. summary --------------------------------------------------------------
TOTAL="$(curl -fsS -m 2 "${RECEIVER_ROOT}/received" | python3 -c 'import sys,json;print(json.load(sys.stdin)["total"])')"
echo
echo "VERIFY OK"
echo "  D2 ${D2_ID}: 1 pending card (~$(python3 -c "print(${D2_WAIT}*0.5)")s), deepLink 200"
echo "  D3 ${D3_ID}: 1 pending card (~$(python3 -c "print(${D3_WAIT}*0.5)")s)"
echo "  receiver total cards: ${TOTAL}"
