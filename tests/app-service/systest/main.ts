import { serveDir } from "jsr:@std/http/file-server";

type AppInstanceIdentity = {
  appId: string;
  ownerUserId: string;
};

type JsonObject = Record<string, unknown>;

type TaskLike = {
  task_id: string;
  root_id: string;
  phase: string;
  outcome?: string;
  revision: number;
  archived_at?: number;
};

type TaskManagerClientLike = {
  createTask: (params: {
    name: string;
    schema_id: string;
    input: unknown;
    executor: { kind: "SelfApp" };
    idempotency_key: string;
  }) => Promise<TaskLike>;
  runnerStart: (taskId: string) => Promise<TaskLike>;
  runnerProgress: (taskId: string, progress?: unknown, message?: string) => Promise<TaskLike>;
  runnerComplete: (taskId: string, result: unknown) => Promise<TaskLike>;
  getTask: (taskId: string) => Promise<TaskLike>;
  listTasks: (params: { root_id?: string }) => Promise<{ tasks: TaskLike[] }>;
  archiveTask: (params: { task_id: string; expected_revision: number }) => Promise<TaskLike>;
};

type SystemConfigClientLike = {
  get: (key: string) => Promise<{ value: string; version: number; is_changed: boolean }>;
  set: (key: string, value: string) => Promise<void>;
};

type NodeSdkModule = {
  buckyos: {
    initBuckyOS: (appid: string, config: Record<string, unknown>) => Promise<void>;
    login: () => Promise<unknown>;
    logout: (cleanAccountInfo?: boolean) => void;
    getAccountInfo: () => Promise<
      {
        user_id?: string;
        user_type?: string;
        session_token?: string | null;
      } | null
    >;
    getZoneHostName: () => string | null;
    getZoneServiceURL: (serviceName: string) => string;
    getAppSetting: (settingName?: string | null) => Promise<unknown>;
    setAppSetting: (settingName: string | null, settingValue: string) => Promise<void>;
    getSystemConfigClient: () => SystemConfigClientLike;
    getTaskManagerClient: () => TaskManagerClientLike;
  };
  RuntimeType: {
    AppService: string;
  };
  parseSessionTokenClaims: (token: string | null | undefined) => Record<string, unknown> | null;
};

const TASK_PHASE_TERMINAL = "Terminal";
const TASK_OUTCOME_SUCCEEDED = "Succeeded";
const RAW_TASK_SCHEMA_ID = "raw/v1";

type SelftestCaseResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
};

const port = Number.parseInt(Deno.env.get("PORT") ?? "3000", 10);
const staticRoot = new URL("./dist", import.meta.url).pathname;
const sdkRoutePrefix = "/sdk/appservice";

function getEnv(name: string): string | null {
  const value = Deno.env.get(name);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseAppInstanceIdentity(appInstanceConfig: string): AppInstanceIdentity {
  const parsed = JSON.parse(appInstanceConfig) as {
    app_spec?: {
      user_id?: unknown;
      app_doc?: {
        name?: unknown;
      };
    };
  };

  const appId = typeof parsed.app_spec?.app_doc?.name === "string"
    ? parsed.app_spec.app_doc.name.trim()
    : "";
  const ownerUserId = typeof parsed.app_spec?.user_id === "string"
    ? parsed.app_spec.user_id.trim()
    : "";

  if (!appId || !ownerUserId) {
    throw new Error("app_instance_config is missing app_spec.user_id or app_spec.app_doc.name");
  }

  return { appId, ownerUserId };
}

function getRustStyleAppServiceTokenEnvKey(identity: AppInstanceIdentity): string {
  return `${identity.ownerUserId}-${identity.appId}`.toUpperCase().replaceAll("-", "_") + "_TOKEN";
}

async function resolveWebSdkRoot(): Promise<string> {
  const explicit = getEnv("BUCKYOS_WEBSDK_ROOT");
  const candidates = [
    explicit,
    "/Users/liuzhicong/project/buckyos-websdk",
    new URL("../../../../buckyos-websdk", import.meta.url).pathname,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`failed to find buckyos-websdk root, tried: ${candidates.join(", ")}`);
}

async function loadSdkModule(): Promise<NodeSdkModule> {
  const sdkRoot = await resolveWebSdkRoot();
  const moduleUrl = new URL(`file://${sdkRoot}/dist/node.mjs`);
  return await import(moduleUrl.href) as NodeSdkModule;
}

function serializeSettingValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function getSettingsPath(identity: AppInstanceIdentity): string {
  return `users/${identity.ownerUserId}/apps/${identity.appId}/settings`;
}

function isMissingSettingsError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("system_config key not found");
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function readJsonBody(request: Request): Promise<JsonObject> {
  const text = (await request.text()).trim();
  if (!text) {
    return {};
  }

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as JsonObject;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function bootstrapSdk() {
  const appInstanceConfig = getEnv("app_instance_config");
  if (!appInstanceConfig) {
    throw new Error("missing app_instance_config; start systest through service_debug.tsx");
  }

  const identity = parseAppInstanceIdentity(appInstanceConfig);
  const expectedTokenKey = getRustStyleAppServiceTokenEnvKey(identity);
  if (!getEnv(expectedTokenKey)) {
    throw new Error(`missing ${expectedTokenKey}; service_debug.tsx should inject it`);
  }

  const sdk = await loadSdkModule();
  await sdk.buckyos.initBuckyOS("", {
    appId: "",
    ownerUserId: identity.ownerUserId,
    runtimeType: sdk.RuntimeType.AppService,
    zoneHost: getEnv("BUCKYOS_ZONE_HOST") ?? "",
    defaultProtocol: "https://",
  });
  await sdk.buckyos.login();

  return { identity, sdk };
}

const { identity, sdk } = await bootstrapSdk();

async function runSelftestCase(
  name: string,
  runCase: () => Promise<Record<string, unknown> | void>,
): Promise<SelftestCaseResult> {
  const startedAt = Date.now();
  try {
    const details = (await runCase()) ?? undefined;
    return {
      name,
      ok: true,
      durationMs: Date.now() - startedAt,
      details: details ?? undefined,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Mirrors the cases in tests/helpers/service_client_suite.ts, but runs them
// here inside the real AppService runtime process so that Jest in a separate
// process can trigger the whole suite with a single HTTP call.
async function runSharedServiceClientSelftest(): Promise<{
  ok: boolean;
  results: SelftestCaseResult[];
}> {
  const results: SelftestCaseResult[] = [];

  results.push(
    await runSelftestCase("SystemConfigClient.get(boot/config)", async () => {
      const bootConfig = await sdk.buckyos.getSystemConfigClient().get("boot/config");
      const parsed = JSON.parse(bootConfig.value) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("boot/config did not decode into an object");
      }
      if (Object.keys(parsed).length === 0) {
        throw new Error("boot/config decoded into an empty object");
      }
      return { version: bootConfig.version };
    }),
  );

  const nowStamp = Date.now();

  results.push(
    await runSelftestCase(
      "SystemConfigClient writes and reads back a namespaced key",
      async () => {
        // The `app` role's RBAC policy only allows writes under
        // `users/{owner}/apps/{appid}/{settings,info}`. Use the `info` slot
        // and embed the unique timestamp inside the value so each test run
        // still verifies a fresh write/read round trip.
        const key = `users/${identity.ownerUserId}/apps/${identity.appId}/info`;
        const value = JSON.stringify({ ok: true, key, ts: nowStamp });
        await sdk.buckyos.getSystemConfigClient().set(key, value);
        const read = await sdk.buckyos.getSystemConfigClient().get(key);
        if (read.value !== value) {
          throw new Error(`value mismatch at ${key}`);
        }
        return { key };
      },
    ),
  );

  results.push(
    await runSelftestCase(
      "getAppSetting/setAppSetting round trip on namespaced key",
      async () => {
        const settingPath = `test_settings.websdk_${nowStamp}`;
        try {
          await sdk.buckyos.setAppSetting(settingPath, '"roundtrip"');
        } catch (error) {
          if (!isMissingSettingsError(error)) {
            throw error;
          }
          // First-time settings write: synthesize the full settings tree at
          // the app-level key so subsequent `setAppSetting` calls succeed.
          const settingsPath = getSettingsPath(identity);
          const segments = settingPath.split(/[./]/).filter(Boolean);
          const rootSettings = segments.reduceRight<unknown>(
            (acc, segment) => ({ [segment]: acc }),
            "roundtrip",
          );
          await sdk.buckyos
            .getSystemConfigClient()
            .set(settingsPath, JSON.stringify(rootSettings));
        }
        const read = await sdk.buckyos.getAppSetting(settingPath);
        if (read !== "roundtrip") {
          throw new Error(`settings round trip mismatch, got ${JSON.stringify(read)}`);
        }
        return { settingPath };
      },
    ),
  );

  results.push(
    await runSelftestCase(
      "TaskManagerClient creates/runs/queries/archives a namespaced task",
      async () => {
        const client = sdk.buckyos.getTaskManagerClient();
        const name = `test-websdk-${nowStamp}`;
        const created = await client.createTask({
          name,
          schema_id: RAW_TASK_SCHEMA_ID,
          input: { createdBy: "websdk-systest", userId: identity.ownerUserId },
          executor: { kind: "SelfApp" },
          idempotency_key: `${identity.appId}:${name}`,
        });
        try {
          await client.runnerStart(created.task_id);
          await client.runnerProgress(created.task_id, { completed: 1, total: 2 });
          await client.runnerComplete(created.task_id, { ok: true });
          const fetched = await client.getTask(created.task_id);
          if (fetched.phase !== TASK_PHASE_TERMINAL || fetched.outcome !== TASK_OUTCOME_SUCCEEDED) {
            throw new Error(
              `expected task ${created.task_id} to succeed, got ${fetched.phase}/${fetched.outcome}`,
            );
          }
          const page = await client.listTasks({ root_id: created.root_id });
          if (!page.tasks.some((task) => task.task_id === created.task_id)) {
            throw new Error(`task ${created.task_id} missing from filtered list`);
          }
          return { taskId: created.task_id };
        } finally {
          try {
            const fresh = await client.getTask(created.task_id);
            if (fresh.phase === TASK_PHASE_TERMINAL && fresh.archived_at === undefined) {
              await client.archiveTask({
                task_id: fresh.task_id,
                expected_revision: fresh.revision,
              });
            }
          } catch {
            // best-effort cleanup, ignore
          }
        }
      },
    ),
  );

  return {
    ok: results.every((result) => result.ok),
    results,
  };
}

console.log(`[sys_test] serving ${staticRoot} on http://0.0.0.0:${port}`);
console.log(`[sys_test] sdk debug routes mounted at ${sdkRoutePrefix}`);

Deno.serve({
  port,
  hostname: "0.0.0.0",
  onListen: ({ hostname, port }) => {
    console.log(`[sys_test] listening on http://${hostname}:${port}`);
    console.log("all test passed");
  },
}, async (req: Request) => {
  try {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === `${sdkRoutePrefix}/healthz`) {
      return jsonResponse({ ok: true });
    }

    if (req.method === "GET" && url.pathname === `${sdkRoutePrefix}/runtime`) {
      const accountInfo = await sdk.buckyos.getAccountInfo();
      return jsonResponse({
        ok: true,
        mode: "app-service-local-debug",
        appId: identity.appId,
        ownerUserId: identity.ownerUserId,
        zoneHost: sdk.buckyos.getZoneHostName(),
        hostGateway: getEnv("BUCKYOS_HOST_GATEWAY"),
        expectedTokenEnvKey: getRustStyleAppServiceTokenEnvKey(identity),
        serviceUrls: {
          verifyHub: sdk.buckyos.getZoneServiceURL("verify-hub"),
          taskManager: sdk.buckyos.getZoneServiceURL("task-manager"),
          systemConfig: sdk.buckyos.getZoneServiceURL("system-config"),
        },
        accountInfo: accountInfo
          ? {
            userId: accountInfo.user_id ?? null,
            userType: accountInfo.user_type ?? null,
          }
          : null,
        tokenClaims: sdk.parseSessionTokenClaims(accountInfo?.session_token ?? null),
      });
    }

    if (req.method === "GET" && url.pathname === `${sdkRoutePrefix}/settings`) {
      const name = url.searchParams.get("name");
      let value: unknown;
      try {
        value = await sdk.buckyos.getAppSetting(name);
      } catch (error) {
        if (!isMissingSettingsError(error)) {
          throw error;
        }
        value = undefined;
      }
      return jsonResponse({
        ok: true,
        name,
        value,
      });
    }

    if (req.method === "POST" && url.pathname === `${sdkRoutePrefix}/settings`) {
      const body = await readJsonBody(req);
      const name = typeof body.name === "string" ? body.name : null;
      const nextValue = Object.prototype.hasOwnProperty.call(body, "value") ? body.value : null;
      if (name == null && (!nextValue || typeof nextValue !== "object" || Array.isArray(nextValue))) {
        throw new Error("POST /sdk/appservice/settings requires an object value when name is null");
      }
      try {
        await sdk.buckyos.setAppSetting(name, serializeSettingValue(nextValue));
      } catch (error) {
        if (!isMissingSettingsError(error)) {
          throw error;
        }
        const settingsPath = getSettingsPath(identity);
        const rootSettings = name == null
          ? nextValue
          : name.split(/[./]/).filter(Boolean).reduceRight<unknown>((acc, segment) => ({ [segment]: acc }), nextValue);
        await sdk.buckyos.getSystemConfigClient().set(settingsPath, JSON.stringify(rootSettings));
      }
      const savedValue = await sdk.buckyos.getAppSetting(name);
      return jsonResponse({
        ok: true,
        name,
        value: savedValue,
      });
    }

    if (req.method === "POST" && url.pathname === `${sdkRoutePrefix}/selftest`) {
      const report = await runSharedServiceClientSelftest();
      return jsonResponse({
        ok: report.ok,
        appId: identity.appId,
        ownerUserId: identity.ownerUserId,
        results: report.results,
      }, report.ok ? 200 : 500);
    }

    if (req.method === "GET" && url.pathname === `${sdkRoutePrefix}/system-config`) {
      const key = url.searchParams.get("key") ?? "boot/config";
      const result = await sdk.buckyos.getSystemConfigClient().get(key);
      return jsonResponse({
        ok: true,
        key,
        version: result.version,
        isChanged: result.is_changed,
        value: tryParseJson(result.value),
      });
    }

    return serveDir(req, {
      fsRoot: staticRoot,
      quiet: true,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
