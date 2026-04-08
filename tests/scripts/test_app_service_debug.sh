#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  test_app_service_debug.sh [owner_user_id] [--port <port>]

Examples:
  ./tests/scripts/test_app_service_debug.sh
  ./tests/scripts/test_app_service_debug.sh devtest
  ./tests/scripts/test_app_service_debug.sh devtest --port 10176
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OWNER_USER_ID="devtest"
PORT="10176"

if [[ $# -gt 0 && "${1}" != -* ]]; then
  OWNER_USER_ID="$1"
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      if [[ $# -lt 2 ]]; then
        echo "missing value for --port" >&2
        exit 2
      fi
      PORT="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

SERVICE_DEBUG_SCRIPT="${REPO_ROOT}/tests/scripts/service_debug.tsx"
DEBUG_SYSTEST_SCRIPT="${REPO_ROOT}/tests/scripts/debug_systest.sh"
APP_ID="buckyos_systest"
HEALTH_URL="http://127.0.0.1:${PORT}/sdk/appservice/healthz"
RUNTIME_URL="http://systest.test.buckyos.io/sdk/appservice/runtime"
SYSTEM_CONFIG_URL="http://systest.test.buckyos.io/sdk/appservice/system-config?key=boot/config"

if [[ ! -f "${SERVICE_DEBUG_SCRIPT}" ]]; then
  echo "missing service_debug script: ${SERVICE_DEBUG_SCRIPT}" >&2
  exit 2
fi

if [[ ! -x "${DEBUG_SYSTEST_SCRIPT}" ]]; then
  echo "missing executable debug script: ${DEBUG_SYSTEST_SCRIPT}" >&2
  exit 2
fi

if ! command -v deno >/dev/null 2>&1; then
  echo "deno is required but was not found in PATH" >&2
  exit 2
fi

if docker info >/dev/null 2>&1; then
  echo "docker service is still running; stop it first, then rerun this script" >&2
  exit 2
fi

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is already in use; stop the existing process or choose another port" >&2
  exit 2
fi

echo "[test_app_service_debug] building SDK"
pnpm run build >/dev/null

ENV_JSON_FILE="$(mktemp -t buckyos-websdk-appservice-env.XXXXXX.json)"
START_LOG_FILE="$(mktemp -t buckyos-websdk-appservice-start.XXXXXX.log)"

cleanup() {
  if [[ -n "${SERVICE_PID:-}" ]]; then
    kill "${SERVICE_PID}" >/dev/null 2>&1 || true
    wait "${SERVICE_PID}" >/dev/null 2>&1 || true
  fi
  rm -f "${ENV_JSON_FILE}" "${START_LOG_FILE}"
}
trap cleanup EXIT

echo "[test_app_service_debug] starting local debug service"
"${DEBUG_SYSTEST_SCRIPT}" "${OWNER_USER_ID}" --port "${PORT}" > "${START_LOG_FILE}" 2>&1 &
SERVICE_PID=$!

echo "[test_app_service_debug] waiting for ${HEALTH_URL}"
for _ in $(seq 1 40); do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
  echo "local debug service did not become ready" >&2
  cat "${START_LOG_FILE}" >&2 || true
  exit 1
fi

echo "[test_app_service_debug] resolving fresh app-service env for jest"
sleep 1
deno run --quiet -A "${SERVICE_DEBUG_SCRIPT}" "${APP_ID}" "${OWNER_USER_ID}" --port "${PORT}" --print-env-json > "${ENV_JSON_FILE}"

APP_SERVICE_TOKEN="$(
  node -e '
    const fs = require("fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const env = payload.env || {};
    const tokenKey = Object.keys(env).find((key) => key.endsWith("_TOKEN") && key.includes("BUCKYOS_SYSTEST"));
    if (!tokenKey) {
      process.exit(2);
    }
    process.stdout.write(String(env[tokenKey]));
  ' "${ENV_JSON_FILE}"
)"

APP_INSTANCE_CONFIG="$(
  node -e '
    const fs = require("fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(payload.env?.app_instance_config || ""));
  ' "${ENV_JSON_FILE}"
)"

HOST_GATEWAY="$(
  node -e '
    const fs = require("fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(payload.env?.BUCKYOS_HOST_GATEWAY || "127.0.0.1"));
  ' "${ENV_JSON_FILE}"
)"

if [[ -z "${APP_SERVICE_TOKEN}" || -z "${APP_INSTANCE_CONFIG}" ]]; then
  echo "failed to resolve app-service env from ${SERVICE_DEBUG_SCRIPT}" >&2
  exit 2
fi

echo "[test_app_service_debug] running app-service jest suite"
BUCKYOS_RUN_INTEGRATION_TESTS=1 \
BUCKYOS_TEST_APP_ID="${APP_ID}" \
BUCKYOS_TEST_OWNER_USER_ID="${OWNER_USER_ID}" \
BUCKYOS_TEST_APP_SERVICE_TOKEN="${APP_SERVICE_TOKEN}" \
BUCKYOS_TEST_APP_INSTANCE_CONFIG="${APP_INSTANCE_CONFIG}" \
BUCKYOS_TEST_HOST_GATEWAY="${HOST_GATEWAY}" \
pnpm exec jest --runInBand tests/app-service

echo "[test_app_service_debug] running gateway smoke checks"
curl -fsS "${RUNTIME_URL}" >/dev/null
curl -fsS "${SYSTEM_CONFIG_URL}" >/dev/null

echo "[test_app_service_debug] app-service tests passed"
