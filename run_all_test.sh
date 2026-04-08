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

Examples:
  ./run_all_test.sh
  ./run_all_test.sh devtest --port 10176
  ./run_all_test.sh --skip-browser
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_SCRIPTS_DIR="${REPO_ROOT}/tests/scripts"

OWNER_USER_ID="devtest"
PORT="10176"
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

step() {
  echo
  echo "================================================================"
  echo "[run_all_test] $*"
  echo "================================================================"
}

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
