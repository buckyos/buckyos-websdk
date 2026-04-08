#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  test_app_service_debug.sh [owner_user_id] [--port <port>]

If --port is omitted, the buckyos_systest port is read from
${BUCKYOS_ROOT:-/opt/buckyos}/etc/node_gateway_info.json (the entry whose
app_id == "buckyos_systest"). The script aborts if it cannot be resolved.

Examples:
  ./tests/scripts/test_app_service_debug.sh
  ./tests/scripts/test_app_service_debug.sh devtest
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUCKYOS_ROOT="${BUCKYOS_ROOT:-/opt/buckyos}"
OWNER_USER_ID="devtest"
# PORT is resolved from ${BUCKYOS_ROOT}/etc/node_gateway_info.json (the entry
# whose app_id == "buckyos_systest") unless --port is given. We do not keep a
# hard-coded default — the gateway routing is the source of truth, and a
# stale guess silently breaks the gateway smoke checks below.
PORT=""

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

resolve_systest_port() {
  local gateway_info="${BUCKYOS_ROOT}/etc/node_gateway_info.json"
  if [[ ! -f "${gateway_info}" ]]; then
    echo "[test_app_service_debug] gateway info file not found: ${gateway_info}" >&2
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[test_app_service_debug] python3 is required to read ${gateway_info}" >&2
    return 1
  fi
  python3 - "${gateway_info}" buckyos_systest <<'PY'
import json, sys
path, app_id = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
for entry in (data.get("app_info") or {}).values():
    if isinstance(entry, dict) and entry.get("app_id") == app_id:
        port = entry.get("port")
        if isinstance(port, int) and 0 < port <= 65535:
            print(port)
            sys.exit(0)
        sys.stderr.write(f"invalid port for {app_id} in {path}: {port!r}\n")
        sys.exit(2)
sys.stderr.write(f"app_id {app_id} not found in {path}\n")
sys.exit(2)
PY
}

if [[ -z "${PORT}" ]]; then
  if ! PORT="$(resolve_systest_port)"; then
    echo "[test_app_service_debug] could not resolve buckyos_systest port from ${BUCKYOS_ROOT}/etc/node_gateway_info.json" >&2
    exit 2
  fi
  echo "[test_app_service_debug] resolved buckyos_systest port from gateway info: ${PORT}"
fi

DEBUG_SYSTEST_SCRIPT="${REPO_ROOT}/tests/scripts/debug_systest.sh"
APP_ID="buckyos_systest"
SYSTEST_BASE_URL="http://127.0.0.1:${PORT}"
HEALTH_URL="${SYSTEST_BASE_URL}/sdk/appservice/healthz"
RUNTIME_URL="http://systest.test.buckyos.io/sdk/appservice/runtime"
SYSTEM_CONFIG_URL="http://systest.test.buckyos.io/sdk/appservice/system-config?key=boot/config"

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

START_LOG_FILE="$(mktemp -t buckyos-websdk-appservice-start.XXXXXX.log)"

cleanup() {
  if [[ -n "${SERVICE_PID:-}" ]]; then
    kill "${SERVICE_PID}" >/dev/null 2>&1 || true
    wait "${SERVICE_PID}" >/dev/null 2>&1 || true
  fi
  rm -f "${START_LOG_FILE}"
}
trap cleanup EXIT

# Start the real AppService through service_debug.tsx. This injects the same
# env (app_instance_config, <OWNER>_<APP>_TOKEN, BUCKYOS_HOST_GATEWAY) that a
# production node-daemon would pass, which is why the Jest side no longer
# tries to synthesize that env on its own.
echo "[test_app_service_debug] starting systest AppService on port ${PORT}"
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
  echo "systest AppService did not become ready" >&2
  cat "${START_LOG_FILE}" >&2 || true
  exit 1
fi

echo "[test_app_service_debug] running app-service jest suite against ${SYSTEST_BASE_URL}"
BUCKYOS_RUN_INTEGRATION_TESTS=1 \
BUCKYOS_TEST_APP_ID="${APP_ID}" \
BUCKYOS_TEST_OWNER_USER_ID="${OWNER_USER_ID}" \
BUCKYOS_TEST_SYSTEST_URL="${SYSTEST_BASE_URL}" \
pnpm exec jest --runInBand tests/app-service

echo "[test_app_service_debug] running gateway smoke checks"
curl -fsS "${RUNTIME_URL}" >/dev/null
curl -fsS "${SYSTEM_CONFIG_URL}" >/dev/null

echo "[test_app_service_debug] app-service tests passed"
