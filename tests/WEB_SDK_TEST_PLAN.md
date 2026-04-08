# Web SDK Test Plan

## Goal

This plan defines how to validate the TypeScript Web SDK against the Rust SDK behavior baseline for these supported scenarios only:

- `Web`
- `AppClient`
- `AppService`

The fixed single-point test environment is:

- Zone host: `test.buckyos.io`

This plan is intentionally implementation-oriented so it can be translated into Jest-based tests and a small number of environment-backed integration tests.

## Test Environment

### Fixed Environment

- Public zone host: `test.buckyos.io`
- Default Web base URL: `https://test.buckyos.io`
- Default kAPI host for AppClient: `https://{app-host-prefix}.test.buckyos.io`
- Default verify-hub URL: `https://test.buckyos.io/kapi/verify-hub`
- Default system-config URL for AppClient/Web checks: `https://test.buckyos.io/kapi/system_config`

### Runtime Variants

- `Web`
  - Browser runtime
  - Uses `window.location`
  - No local private key
- `AppClient`
  - Node runtime
  - Requires local private key material
  - Uses `test.buckyos.io` as zone host
- `AppService`
  - Node runtime
  - Requires `app_instance_config`
  - Requires injected service token env
  - Should validate both direct local host and `BUCKYOS_HOST_GATEWAY`

### Required Test Inputs

- Test app id
- Test app-service owner user id
- Test app-service token env
- Test AppClient private key directory
- Test Web/VerifyHub test user
- Optional refresh token rotation test user

Suggested env names:

- `BUCKYOS_TEST_ZONE_HOST=test.buckyos.io`
- `BUCKYOS_TEST_APP_ID=<app-id>`
- `BUCKYOS_TEST_OWNER_USER_ID=<user-id>`
- `BUCKYOS_TEST_USERNAME=<username>`
- `BUCKYOS_TEST_PASSWORD=<password>`
- `BUCKYOS_TEST_APP_CLIENT_DIR=<path>`
- `BUCKYOS_TEST_APP_INSTANCE_CONFIG=<json>`
- `BUCKYOS_TEST_APP_SERVICE_TOKEN=<token>`
- `BUCKYOS_HOST_GATEWAY=<host-or-ip>`

## Scope

### In Scope

- Public SDK surface exported from [src/index.ts](/Users/liuzhicong/project/buckyos-websdk/src/index.ts), [src/browser.ts](/Users/liuzhicong/project/buckyos-websdk/src/browser.ts), and [src/node.ts](/Users/liuzhicong/project/buckyos-websdk/src/node.ts)
- Runtime init/login behavior in [src/sdk_core.ts](/Users/liuzhicong/project/buckyos-websdk/src/sdk_core.ts) and [src/runtime.ts](/Users/liuzhicong/project/buckyos-websdk/src/runtime.ts)
- Service clients:
  - [src/system_config_client.ts](/Users/liuzhicong/project/buckyos-websdk/src/system_config_client.ts)
  - [src/verify-hub-client.ts](/Users/liuzhicong/project/buckyos-websdk/src/verify-hub-client.ts)
  - [src/task_mgr_client.ts](/Users/liuzhicong/project/buckyos-websdk/src/task_mgr_client.ts)
  - [src/opendan_client.ts](/Users/liuzhicong/project/buckyos-websdk/src/opendan_client.ts)
- Account helpers in [src/account.ts](/Users/liuzhicong/project/buckyos-websdk/src/account.ts)
- kRPC transport in [src/krpc_client.ts](/Users/liuzhicong/project/buckyos-websdk/src/krpc_client.ts)

### Out of Scope

- `Kernel`, `KernelService`, `FrameService`
- Multi-zone routing
- Performance benchmarking
- Chaos/fault injection beyond basic retry/error-path checks

## Test Layers

### Layer 1: Pure Unit Tests

Goal:
- Validate deterministic local behavior without external dependency.

Targets:
- `hashPassword`
- token claims parsing
- kRPC request/response packing
- request schema mapping for all clients
- settings path traversal helpers
- task status parsing

Expected location:
- `tests/browser/*.test.ts`
- `tests/app-client/*.test.ts`
- `tests/app-service/*.test.ts`

### Layer 2: Mocked Integration Tests

Goal:
- Validate SDK behavior against Rust-compatible RPC contracts using mocked HTTP responses.

Targets:
- VerifyHub request payloads and response normalization
- TaskManager request and response compatibility
- OpenDan request and response compatibility
- SystemConfig cache/version/is_changed behavior
- AppService URL resolution with `BUCKYOS_HOST_GATEWAY`

Expected location:
- `tests/browser/*.test.ts`
- `tests/app-client/*.test.ts`
- `tests/app-service/*.test.ts`

### Layer 3: Environment-backed Integration Tests

Goal:
- Validate the SDK against the real single-point environment `test.buckyos.io`.

Targets:
- Web login against verify-hub
- AppClient init/login/system-config read
- AppService init/system-config/service-client access
- token refresh path
- settings read/write round trip

Expected location:
- `tests/browser/integration/*`
- `tests/app-client/integration/*`
- `tests/app-service/integration/*`

## Test Matrix

### A. kRPC Transport

Cases:

- Sends JSON body with `method`, `params`, `sys`
- Includes token in `sys[1]` when session token exists
- Updates local token from response `sys`
- Rejects seq mismatch
- Rejects malformed `sys`
- Rejects HTTP non-200 response
- Rejects RPC error payload

### B. VerifyHub

Cases:

- `loginByPassword` sends Rust-compatible payload:
  - `type=password`
  - `username`
  - `password`
  - `appid`
- `loginByJwt` sends Rust-compatible payload:
  - `type=jwt`
  - `jwt`
- `refreshToken` request matches Rust contract
- `verifyToken` request matches Rust contract
- Normalizes both current and legacy login responses
- Clears inherited session token before login RPC

Environment-backed cases:

- Valid test account can login on `test.buckyos.io`
- Returned token claims contain expected `appid`
- Refresh token rotates session token when available

### C. Runtime Init

#### Web

Cases:

- Browser runtime infers `Browser` or `AppRuntime`
- `zoneHost` resolves to `test.buckyos.io`
- `getZoneServiceURL('verify-hub')` maps to `https://{host}/kapi/verify-hub`
- Local account storage is app-scoped

#### AppClient

Cases:

- Loads private key from configured search roots
- Resolves zone host from explicit config
- Resolves zone host from local config fallback when explicit host missing
- Generates local JWT with correct `appid`
- `login()` triggers runtime bootstrap and starts token maintenance
- `getSystemConfigServiceURL()` points to `https://test.buckyos.io/kapi/system_config`
- `getZoneServiceURL(service)` uses app host prefix and zone host

Environment-backed cases:

- Can login with local private key and access real `system_config`
- Can read `boot/config`
- Can access `verify-hub`, `task-manager`, `opendan` clients after login

#### AppService

Cases:

- Resolves `app_id` and `owner_user_id` from `app_instance_config`
- Loads token from env with both:
  - `{OWNER}_{APP}_TOKEN`
  - `{APP}_TOKEN`
- Uses `BUCKYOS_HOST_GATEWAY` when present
- Falls back to `host.docker.internal` when host gateway env missing
- `getSystemConfigServiceURL()` and `getZoneServiceURL()` use local node-gateway pattern
- `login()` starts refresh loop

Environment-backed cases:

- Can read app/service settings through local gateway route
- Can refresh token when initial token is near expiry

### D. Settings API

Cases:

- `getAppSetting(null)` returns full settings object
- `getAppSetting('a.b.c')` reads nested value
- `getAppSetting('a/b/c')` reads nested value
- missing nested value returns `undefined`
- `setAppSetting('a.b.c', '1')` updates nested key
- `setAppSetting(null, '{...json...}')` replaces full settings object
- invalid full-object replacement throws
- persisted value can be read back through `getAppSetting`

Environment-backed cases:

- AppService settings round trip:
  - read original settings
  - write test namespaced key
  - read back updated value
- Optional cleanup step restores previous value

### E. SystemConfigClient

Cases:

- `get()` returns cache miss with non-zero version
- cached `get()` returns `version=0` and `is_changed=false`
- `set()` updates cache
- `setByJsonPath()` invalidates cache
- `delete()` invalidates cache
- `append()` invalidates cache
- `list()` maps array result
- `execTx()` clears touched cache keys
- `refreshTrustKeys()` sends expected RPC method

Environment-backed cases:

- can read stable key from `test.buckyos.io`
- can write and read back test-only namespaced key

### F. TaskManagerClient

Cases:

- `createTask` sends Rust-compatible payload
- `createTask` includes `root_id` as string
- `listTasks` filters by `root_id` as string
- `createDownloadTask` sends Rust-compatible payload
- `getTask`, `listTasks`, `getSubtasks` accept both wrapped and task-only response shapes
- `waitForTaskEnd` stops on terminal states
- helper methods map to expected status transitions

Environment-backed cases:

- create a namespaced test task
- query it by id
- query it by `root_id`
- update progress / data / status
- delete or cancel it during cleanup

### G. OpenDanClient

Cases:

- request payloads match Rust field names
- `getWorkspace()` aliases `getWorkshop()`
- `getAgentSession()` behavior matches server expectation
- `pauseSession()` and `resumeSession()` use the expected RPC methods

Environment-backed cases:

- list agents succeeds on `test.buckyos.io`
- fetch agent/workshop/session data with a known test agent if available

### H. Account Storage

Cases:

- local account info is stored per app id
- legacy scoped migration still works
- logout removes scoped local storage
- cookie key format remains `{appId}_token`

Browser-only cases:

- auto-login restores scoped account from localStorage
- account from another app id is ignored

## Execution Order

### Phase 1

- Stabilize all pure unit tests
- No external environment required

### Phase 2

- Add mocked integration tests for all RPC clients
- Ensure request/response shapes are Rust-compatible

### Phase 3

- Add environment-backed integration tests against `test.buckyos.io`
- Gate them behind explicit env flags

Suggested flag:

- `BUCKYOS_RUN_INTEGRATION_TESTS=1`

## Isolation Rules

- All write tests must use namespaced keys or task names
- Prefix test-created data with:
  - `test/websdk/`
  - `test-websdk-`
- Every write test should either:
  - clean up after itself, or
  - overwrite only within a dedicated disposable namespace

Suggested namespaces:

- System config keys: `test/websdk/<app-id>/...`
- Task names: `test-websdk-<timestamp>`
- Settings keys: `test_settings.websdk.<timestamp>`

## Exit Criteria

Minimum pass criteria before release:

- All unit tests pass
- All mocked integration tests pass
- AppClient integration against `test.buckyos.io` passes
- AppService integration against local gateway route passes
- Web login integration against `test.buckyos.io` passes
- No known mismatch remains for:
  - settings behavior
  - AppService host resolution
  - TaskManager `root_id`
  - token refresh path

## Proposed File Layout

- `tests/browser/account.test.ts`
- `tests/browser/auth_client.test.ts`
- `tests/browser/runtime.browser.test.ts`
- `tests/browser/sdk_settings.test.ts`
- `tests/browser/integration/web_runtime_test.ts`
- `tests/app-client/runtime.unit.test.ts`
- `tests/app-client/system_config_client.test.ts`
- `tests/app-client/task_mgr_client.test.ts`
- `tests/app-client/opendan_client.test.ts`
- `tests/app-client/verify_hub_client.test.ts`
- `tests/app-client/integration/app_client_test.ts`
- `tests/app-service/runtime.appservice.test.ts`
- `tests/app-service/integration/app_service_test.ts`

## Current Priority Order

1. Add runtime-focused unit tests for `AppClient` and `AppService`
2. Add settings API tests
3. Add `SystemConfigClient` cache semantics tests
4. Add `TaskManager root_id` coverage
5. Add `AppClient` integration against `test.buckyos.io`
6. Add `AppService` integration with local gateway host override

## Notes

- Integration tests should never assume local `127.0.0.1:3200` unless the case is explicitly validating local node-gateway routing.
- For public single-point tests, the canonical host is always `test.buckyos.io`.
- If some OpenDan or TaskManager capabilities are not enabled in the shared environment, keep those cases optional and gate them by dedicated env flags.
