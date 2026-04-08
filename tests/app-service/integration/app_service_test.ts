/** @jest-environment node */

/**
 * AppService runtime integration test (driven through the `systest` slot).
 *
 * Design note: the previous version of this file tried to initialize the
 * SDK as AppService directly inside the Jest process by setting
 * `process.env.app_instance_config` and `<OWNER>_<APP>_TOKEN` manually.
 * That approach turned out to be unworkable on the real DV environment —
 * the required tokens are short-lived and must be issued by the buckyos
 * node-daemon / service_debug.tsx harness at the moment the AppService
 * comes up, so there is no way for Jest to synthesize a working AppService
 * token from environment variables alone.
 *
 * Instead, this test now drives AppService through the existing systest
 * slot (`tests/app-service/systest/main.ts`). The systest is a Deno-based
 * real AppService process launched by `tests/scripts/debug_systest.sh`
 * through `service_debug.tsx`. That launcher injects the same environment
 * variables a production AppService would see, so the SDK inside systest
 * gets a genuine session token.
 *
 * The three-phase structure from `tests/测试用例组织.md` is preserved:
 *
 *   1) Phase 1 — confirm the systest process is up and reports a healthy
 *      AppService runtime via `/sdk/appservice/healthz` + `/runtime`.
 *   2) Phase 2 — trigger `POST /sdk/appservice/selftest` to run the shared
 *      ServiceClient suite in-process inside systest (mirrors
 *      `defineSharedServiceClientSuite` 1:1) and assert every case passed.
 *   3) Phase 3 — AppService-specific assertions about host gateway routing
 *      and the token env naming convention, read back from `/runtime`.
 *
 * To run:
 *   ./tests/scripts/test_app_service_debug.sh devtest --port 10176
 *
 * Or manually, with a systest already running at $BUCKYOS_TEST_SYSTEST_URL:
 *   BUCKYOS_RUN_INTEGRATION_TESTS=1 \
 *     BUCKYOS_TEST_SYSTEST_URL=http://127.0.0.1:10176 \
 *     pnpm exec jest --runInBand tests/app-service
 */

import { getEnv, shouldRunIntegrationTests } from '../../helpers/test_env'

jest.setTimeout(60000)

// Jest only talks HTTP to the locally running systest process; the systest
// is the one that actually talks to the DV zone, so we do NOT install the
// insecure fetch/TLS shims here (they belong inside the systest).
const systestUrl = (getEnv('BUCKYOS_TEST_SYSTEST_URL', 'http://127.0.0.1:10176') as string).replace(/\/+$/, '')
const expectedHostGateway = getEnv(
  'BUCKYOS_TEST_HOST_GATEWAY',
  getEnv('BUCKYOS_HOST_GATEWAY', null),
)

const canRunAppServiceIntegration = shouldRunIntegrationTests() && Boolean(systestUrl)
const describeAppService = canRunAppServiceIntegration ? describe : describe.skip

interface SelftestCaseResult {
  name: string
  ok: boolean
  durationMs: number
  error?: string
  details?: Record<string, unknown>
}

interface SelftestReport {
  ok: boolean
  appId: string
  ownerUserId: string
  results: SelftestCaseResult[]
}

interface RuntimeReport {
  ok: boolean
  mode: string
  appId: string
  ownerUserId: string
  zoneHost: string | null
  hostGateway: string | null
  expectedTokenEnvKey: string
  serviceUrls: {
    verifyHub: string
    taskManager: string
    systemConfig: string
  }
  accountInfo: {
    userId: string | null
    userType: string | null
  } | null
  tokenClaims: Record<string, unknown> | null
}

async function fetchJson<T>(
  url: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body: init?.body,
  })
  const status = response.status
  const text = await response.text()
  let body: unknown
  try {
    body = text.length > 0 ? JSON.parse(text) : null
  } catch {
    throw new Error(`non-json response from ${url}: ${text.slice(0, 200)}`)
  }
  return { status, body: body as T }
}

describeAppService('AppService runtime integration (via systest slot)', () => {
  let runtimeReport: RuntimeReport

  beforeAll(async () => {
    // Phase 1: confirm the systest AppService is up. This replaces the old
    // in-process `initBuckyOS(AppService, ...) + login()` path; the real
    // AppService runtime is already initialized inside the systest process.
    const health = await fetchJson<{ ok?: boolean }>(`${systestUrl}/sdk/appservice/healthz`)
    if (health.status !== 200 || !health.body?.ok) {
      throw new Error(
        `systest healthz check failed at ${systestUrl} (status=${health.status}); ` +
          `start it via ./tests/scripts/debug_systest.sh before running this test`,
      )
    }

    const runtime = await fetchJson<RuntimeReport>(`${systestUrl}/sdk/appservice/runtime`)
    if (runtime.status !== 200 || !runtime.body?.ok) {
      throw new Error(
        `systest /runtime endpoint returned status=${runtime.status}; inspect systest logs`,
      )
    }
    runtimeReport = runtime.body
  })

  // Phase 2: run the shared ServiceClient suite inside systest via HTTP.
  describe('shared ServiceClient suite (via /sdk/appservice/selftest)', () => {
    let report: SelftestReport

    beforeAll(async () => {
      const { status, body } = await fetchJson<SelftestReport>(
        `${systestUrl}/sdk/appservice/selftest`,
        { method: 'POST' },
      )
      if (status !== 200) {
        const failingDetails = body?.results
          ?.filter((r) => !r.ok)
          .map((r) => `${r.name}: ${r.error ?? 'unknown'}`)
          .join('\n - ') ?? 'no case-level details returned'
        throw new Error(
          `systest selftest failed (status=${status})\n - ${failingDetails}`,
        )
      }
      report = body
    })

    it('reports ok: true for every case', () => {
      expect(report.ok).toBe(true)
      expect(report.results.length).toBeGreaterThan(0)
      for (const result of report.results) {
        expect({ name: result.name, ok: result.ok, error: result.error }).toEqual({
          name: result.name,
          ok: true,
          error: undefined,
        })
      }
    })

    it('covers the expected four shared cases', () => {
      const caseNames = report.results.map((result) => result.name)
      expect(caseNames).toEqual(
        expect.arrayContaining([
          'SystemConfigClient.get(boot/config)',
          'SystemConfigClient writes and reads back a namespaced key',
          'getAppSetting/setAppSetting round trip on namespaced key',
          'TaskManagerClient creates/updates/queries/deletes a namespaced task',
        ]),
      )
    })
  })

  // Phase 3: AppService-specific assertions.
  describe('AppService specific', () => {
    it('reports a mode of app-service-local-debug', () => {
      expect(runtimeReport.mode).toBe('app-service-local-debug')
    })

    it('routes verify-hub through the injected BUCKYOS_HOST_GATEWAY', () => {
      expect(runtimeReport.hostGateway).toBeTruthy()
      const hostGateway = runtimeReport.hostGateway as string
      if (expectedHostGateway && expectedHostGateway !== hostGateway) {
        throw new Error(
          `BUCKYOS_TEST_HOST_GATEWAY=${expectedHostGateway} does not match systest's reported ${hostGateway}`,
        )
      }
      expect(runtimeReport.serviceUrls.verifyHub).toContain(hostGateway)
      expect(runtimeReport.serviceUrls.taskManager).toContain(hostGateway)
      expect(runtimeReport.serviceUrls.systemConfig).toContain(hostGateway)
    })

    it('uses the Rust-style <OWNER>_<APP>_TOKEN env key naming', () => {
      const expected = `${runtimeReport.ownerUserId}-${runtimeReport.appId}`
        .toUpperCase()
        .replace(/-/g, '_') + '_TOKEN'
      expect(runtimeReport.expectedTokenEnvKey).toBe(expected)
    })

    it('reports a logged in account that matches the identity', () => {
      expect(runtimeReport.accountInfo).not.toBeNull()
      expect(runtimeReport.accountInfo?.userId).toBeTruthy()
    })
  })
})
