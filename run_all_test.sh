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
#               d) tear the systest back down
#             That whole orchestration already lives in
#             test_app_service_debug.sh, so we delegate to it.
#
#   Phase 4 — real browser playwright tests
#             Heaviest phase; downloads playwright browsers on first run.
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

cleanup_on_exit() {
  local exit_code="$1"
  if [[ "${SKIP_APP_SERVICE}" -eq 0 && -n "${PORT}" ]]; then
    echo
    echo "================================================================"
    echo "[run_all_test] cleanup test services (port ${PORT})"
    echo "================================================================"
    kill_test_services "${PORT}"
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

# Phase 3 — AppService integration. Delegated to test_app_service_debug.sh,
# which handles the systest start/wait/run/teardown sequence end-to-end.
if [[ "${SKIP_APP_SERVICE}" -eq 0 ]]; then
  step "Phase 3 — AppService integration (via systest slot)"
  bash "${TESTS_SCRIPTS_DIR}/test_app_service_debug.sh" "${OWNER_USER_ID}" --port "${PORT}"
else
  echo "[run_all_test] skipping Phase 3 AppService integration (--skip-app-service)"
fi

# Phase 4 — real browser playwright tests.
if [[ "${SKIP_BROWSER}" -eq 0 ]]; then
  step "Phase 4 — real browser (playwright)"
  pnpm run test:browser:real
else
  echo "[run_all_test] skipping Phase 4 real-browser tests (--skip-browser)"
fi

echo
echo "[run_all_test] all selected phases passed"
