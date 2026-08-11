#!/usr/bin/env bash
set -euo pipefail

# Run the full SDK test suite in the correct order:
#
#   Phase 1 — unit tests (no DV env required)
#             Plain `jest` run; integration `describe` blocks are gated on
#             BUCKYOS_RUN_INTEGRATION_TESTS so they self-skip here.
#
#   Phase 2 — AppClient integration tests
#             Self-contained: jest loads a local private key and talks to
#             the DV zone directly. No systest required.
#
#   Phase 3 — AppService integration tests (THE non-trivial init order)
#             AppService cannot be initialized inside the jest process —
#             the <OWNER>_<APP>_TOKEN must be issued by service_debug.tsx
#             at the moment systest comes up. The required sequence is:
#               a) start the Deno systest (debug_systest.sh -> service_debug.tsx)
#               b) wait for /sdk/appservice/healthz to return ok
#               c) run jest tests/app-service against the live systest
#
#   Phase 4 — real browser playwright tests
#             When Phase 3 is enabled, Phase 4 must reuse the same local
#             `buckyos_systest` slot. Otherwise the gateway host
#             `https://systest.test.buckyos.io/*.html` points at an empty
#             slot (docker is intentionally stopped in local-debug mode) and
#             the browser pages fail with 500.
#
# All Layer 3 / integration phases assume the DV environment is reachable.

usage() {
  cat <<'EOF'
Usage:
  run_all_test.sh [owner_user_id] [--port <port>]
                  [--skip-unit] [--skip-app-client]
                  [--skip-app-service] [--skip-browser]

If --port is omitted, the buckyos_systest port is read from
${BUCKYOS_ROOT:-/opt/buckyos}/etc/node_gateway_info.json (the entry whose
app_id == "buckyos_systest"). The script aborts if it cannot be resolved.

Examples:
  ./run_all_test.sh
  ./run_all_test.sh devtest
  ./run_all_test.sh --skip-browser
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_SCRIPTS_DIR="${REPO_ROOT}/tests/scripts"
BUCKYOS_ROOT="${BUCKYOS_ROOT:-/opt/buckyos}"
DEBUG_SYSTEST_SCRIPT="${TESTS_SCRIPTS_DIR}/debug_systest.sh"
APP_ID="buckyos_systest"
PLAYWRIGHT_REAL_BROWSER_TESTS=(
  tests/browser/real-browser/playwright.spec.js
  tests/browser/real-browser/ndn_types.spec.js
  tests/browser/real-browser/ndm_client.spec.js
  tests/browser/real-browser/ndm_client_upload.spec.js
)

OWNER_USER_ID="devtest"
# PORT is resolved from ${BUCKYOS_ROOT}/etc/node_gateway_info.json (the entry
# whose app_id == "buckyos_systest") unless --port is explicitly given. We do
# not keep a hard-coded fallback — the gateway routing is the source of truth,
# and a stale guess silently breaks the gateway smoke checks in Phase 3.
PORT=""
SKIP_UNIT=0
SKIP_APP_CLIENT=0
SKIP_APP_SERVICE=0
SKIP_BROWSER=0
LOCAL_SYSTEST_PID=""
LOCAL_SYSTEST_LOG_FILE=""

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
    --skip-unit)        SKIP_UNIT=1;        shift ;;
    --skip-app-client)  SKIP_APP_CLIENT=1;  shift ;;
    --skip-app-service) SKIP_APP_SERVICE=1; shift ;;
    --skip-browser)     SKIP_BROWSER=1;     shift ;;
    -h|--help)          usage; exit 0 ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

cd "${REPO_ROOT}"

# Resolve the buckyos_systest port from the live gateway info file, so the
# test always uses whatever port the BuckyOS scheduler actually wired the
# `systest.test.buckyos.io` virtual host to. We refuse to fall back to a
# guessed default — see the PORT comment above.
resolve_systest_port() {
  local gateway_info="${BUCKYOS_ROOT}/etc/node_gateway_info.json"
  if [[ ! -f "${gateway_info}" ]]; then
    echo "[run_all_test] gateway info file not found: ${gateway_info}" >&2
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[run_all_test] python3 is required to read ${gateway_info}" >&2
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
    echo "[run_all_test] could not resolve buckyos_systest port from ${BUCKYOS_ROOT}/etc/node_gateway_info.json" >&2
    exit 2
  fi
  echo "[run_all_test] resolved buckyos_systest port from gateway info: ${PORT}"
fi

step() {
  echo
  echo "================================================================"
  echo "[run_all_test] $*"
  echo "================================================================"
}

require_local_systest_prereqs() {
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
}

# Kill anything left over from a previous (possibly crashed) test run that
# would otherwise hold the systest port or keep the systest deno child
# alive. test_app_service_debug.sh's port-in-use check would otherwise abort
# Phase 3 with "port already in use".
kill_test_services() {
  local port="$1"

  # 1) Anything currently listening on the systest port (covers the deno
  #    main.ts process that serves /sdk/appservice/*).
  if command -v lsof >/dev/null 2>&1; then
    local listen_pids
    listen_pids="$(lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${listen_pids}" ]]; then
      echo "[run_all_test] killing leftover listener(s) on :${port}: ${listen_pids}"
      # shellcheck disable=SC2086
      kill ${listen_pids} 2>/dev/null || true
      sleep 1
      listen_pids="$(lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
      if [[ -n "${listen_pids}" ]]; then
        echo "[run_all_test] forcing kill -9 on stragglers: ${listen_pids}"
        # shellcheck disable=SC2086
        kill -9 ${listen_pids} 2>/dev/null || true
      fi
    fi
  fi

  # 2) Any leftover deno processes still running our systest entrypoints
  #    (service_debug.tsx and the systest main.ts) — they may not bind the
  #    port directly but can still hold child processes / file locks.
  if command -v pkill >/dev/null 2>&1; then
    pkill -f 'service_debug\.tsx'                  >/dev/null 2>&1 || true
    pkill -f 'buckyos_systest/main\.ts'            >/dev/null 2>&1 || true
    pkill -f 'tests/app-service/systest/main\.ts'  >/dev/null 2>&1 || true
  fi
}

start_local_systest() {
  local health_url="http://127.0.0.1:${PORT}/sdk/appservice/healthz"

  if [[ -n "${LOCAL_SYSTEST_PID}" ]]; then
    return 0
  fi

  require_local_systest_prereqs

  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port ${PORT} is already in use; stop the existing process or choose another port" >&2
    exit 2
  fi

  LOCAL_SYSTEST_LOG_FILE="$(mktemp -t buckyos-websdk-run-all-systest.XXXXXX.log)"

  echo "[run_all_test] starting local systest AppService on port ${PORT}"
  "${DEBUG_SYSTEST_SCRIPT}" "${OWNER_USER_ID}" --port "${PORT}" > "${LOCAL_SYSTEST_LOG_FILE}" 2>&1 &
  LOCAL_SYSTEST_PID=$!

  echo "[run_all_test] waiting for ${health_url}"
  for _ in $(seq 1 40); do
    if curl -fsS "${health_url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "local systest AppService did not become ready" >&2
  cat "${LOCAL_SYSTEST_LOG_FILE}" >&2 || true
  exit 1
}

prepare_real_browser_assets() {
  echo "[run_all_test] preparing real-browser assets in ${BUCKYOS_ROOT}/bin/${APP_ID}/dist"
  pnpm run test:browser:real:prepare
}

run_app_service_phase() {
  local systest_base_url="http://127.0.0.1:${PORT}"
  local runtime_url="http://systest.test.buckyos.io/sdk/appservice/runtime"
  local system_config_url="http://systest.test.buckyos.io/sdk/appservice/system-config?key=boot/config"

  echo "[run_all_test] running app-service jest suite against ${systest_base_url}"
  BUCKYOS_RUN_INTEGRATION_TESTS=1 \
    BUCKYOS_TEST_APP_ID="${APP_ID}" \
    BUCKYOS_TEST_OWNER_USER_ID="${OWNER_USER_ID}" \
    BUCKYOS_TEST_SYSTEST_URL="${systest_base_url}" \
    pnpm exec jest --runInBand tests/app-service

  echo "[run_all_test] running gateway smoke checks"
  curl -fsS "${runtime_url}" >/dev/null
  curl -fsS "${system_config_url}" >/dev/null
}

run_real_browser_playwright() {
  npx playwright test \
    "${PLAYWRIGHT_REAL_BROWSER_TESTS[@]}" \
    --reporter=line
}

cleanup_on_exit() {
  local exit_code="$1"
  if [[ -n "${LOCAL_SYSTEST_PID}" ]]; then
    kill "${LOCAL_SYSTEST_PID}" >/dev/null 2>&1 || true
    wait "${LOCAL_SYSTEST_PID}" >/dev/null 2>&1 || true
  fi
  if [[ "${SKIP_APP_SERVICE}" -eq 0 && -n "${PORT}" ]]; then
    echo
    echo "================================================================"
    echo "[run_all_test] cleanup test services (port ${PORT})"
    echo "================================================================"
    kill_test_services "${PORT}"
  fi
  if [[ -n "${LOCAL_SYSTEST_LOG_FILE}" ]]; then
    rm -f "${LOCAL_SYSTEST_LOG_FILE}"
  fi
  return "${exit_code}"
}

trap 'rc=$?; trap - EXIT; cleanup_on_exit "${rc}"; exit "${rc}"' EXIT

step "killing leftover test services (port ${PORT})"
kill_test_services "${PORT}"

# Build once. test_app_service_debug.sh and the real-browser script will
# rebuild on their own — that is acceptable; we build here so phases 1 and
# 2 also see fresh dist/.
step "building SDK"
pnpm run build >/dev/null

# Phase 1 — unit tests. No BUCKYOS_RUN_INTEGRATION_TESTS, so the
# integration `describe` blocks self-skip via shouldRunIntegrationTests().
if [[ "${SKIP_UNIT}" -eq 0 ]]; then
  step "Phase 1 — unit tests"
  pnpm exec jest --runInBand
else
  echo "[run_all_test] skipping Phase 1 unit tests (--skip-unit)"
fi

# Phase 2 — AppClient integration. Self-contained (local private key).
if [[ "${SKIP_APP_CLIENT}" -eq 0 ]]; then
  step "Phase 2 — AppClient integration"
  BUCKYOS_RUN_INTEGRATION_TESTS=1 \
    pnpm exec jest --runInBand tests/app-client/integration
else
  echo "[run_all_test] skipping Phase 2 AppClient integration (--skip-app-client)"
fi

# When AppService integration is enabled, keep the local systest slot alive
# across both Phase 3 and Phase 4. The browser tests are served by the same
# `buckyos_systest` host slot, so tearing the debug service down after the
# Jest phase leaves `https://systest.test.buckyos.io/*.html` pointing at an
# empty gateway target and causes 500s.
if [[ "${SKIP_APP_SERVICE}" -eq 0 && "${SKIP_BROWSER}" -eq 0 ]]; then
  require_local_systest_prereqs
  step "preparing real-browser assets for the local systest slot"
  prepare_real_browser_assets
fi

if [[ "${SKIP_APP_SERVICE}" -eq 0 ]]; then
  step "starting local systest debug service (shared by Phase 3 / Phase 4)"
  start_local_systest

  step "Phase 3 — AppService integration (via systest slot)"
  run_app_service_phase
else
  echo "[run_all_test] skipping Phase 3 AppService integration (--skip-app-service)"
fi

# Phase 4 — real browser playwright tests.
if [[ "${SKIP_BROWSER}" -eq 0 ]]; then
  step "Phase 4 — real browser (playwright)"
  if [[ "${SKIP_APP_SERVICE}" -eq 0 ]]; then
    run_real_browser_playwright
  else
    pnpm run test:browser:real
  fi
else
  echo "[run_all_test] skipping Phase 4 real-browser tests (--skip-browser)"
fi

echo
echo "[run_all_test] all selected phases passed"
