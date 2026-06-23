import { h as ht, O as ObjId, C as ChunkId, F as FileObject, s as sha256Bytes, D as DirObject, S as SimpleChunkList } from "./ndn_types-e2a3628e.mjs";
class RPCError extends Error {
  constructor(message) {
    super(message);
    this.name = "RPCError";
  }
}
const defaultFetcher$1 = async (input, init) => {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch(input, init);
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch(input, init);
  }
  throw new RPCError("fetch is not available in this runtime");
};
class kRPCClient {
  constructor(url, token = null, seq = null, options = {}) {
    this.serverUrl = url;
    this.protocolType = "HttpPostJson";
    this.seq = seq ?? Date.now();
    this.sessionToken = token || null;
    this.initToken = token || null;
    this.fetcher = options.fetcher ?? defaultFetcher$1;
    this.sessionTokenProvider = options.sessionTokenProvider ?? null;
    this.onSessionTokenChanged = options.onSessionTokenChanged ?? null;
    this.sessionTokenOverride = void 0;
  }
  async call(method, params, options = {}) {
    return this._call(method, params, options);
  }
  async callWithSessionToken(sessionToken, method, params) {
    return this._call(method, params, { sessionToken });
  }
  setSeq(seq) {
    this.seq = seq;
  }
  resetSessionToken() {
    this.sessionToken = this.initToken;
    this.sessionTokenOverride = void 0;
  }
  setSessionToken(token) {
    this.sessionToken = token || null;
    this.sessionTokenOverride = token || null;
  }
  getSessionToken() {
    return this.sessionToken;
  }
  buildRequest(method, params, seq, sessionToken) {
    const sys = sessionToken ? [seq, sessionToken] : [seq];
    return {
      method,
      params,
      sys
    };
  }
  parseSys(sys, currentSeq) {
    if (sys === void 0 || sys === null) {
      return null;
    }
    if (!Array.isArray(sys)) {
      throw new RPCError("sys is not array");
    }
    if (sys.length < 1) {
      throw new RPCError("sys is empty");
    }
    const responseSeq = sys[0];
    if (typeof responseSeq !== "number") {
      throw new RPCError("sys[0] is not number");
    }
    if (responseSeq !== currentSeq) {
      throw new RPCError(`seq not match: ${responseSeq}!=${currentSeq}`);
    }
    if (sys.length >= 2) {
      const token = sys[1];
      if (typeof token !== "string") {
        throw new RPCError("sys[1] is not string");
      }
      return token;
    }
    return null;
  }
  hasCallSessionToken(options) {
    return Object.prototype.hasOwnProperty.call(options, "sessionToken");
  }
  async prepareSessionToken(options) {
    if (this.hasCallSessionToken(options)) {
      return {
        sessionToken: options.sessionToken || null,
        isTemporary: true,
        isOverride: false
      };
    }
    if (this.sessionTokenOverride !== void 0) {
      return {
        sessionToken: this.sessionTokenOverride,
        isTemporary: false,
        isOverride: true
      };
    }
    if (this.sessionTokenProvider) {
      const preparedToken = await this.sessionTokenProvider();
      if (preparedToken !== void 0) {
        this.sessionToken = preparedToken || null;
      }
    }
    return {
      sessionToken: this.sessionToken,
      isTemporary: false,
      isOverride: false
    };
  }
  async _call(method, params, options) {
    const preparedSession = await this.prepareSessionToken(options);
    const currentSeq = this.seq;
    this.seq += 1;
    const requestBody = this.buildRequest(method, params, currentSeq, preparedSession.sessionToken);
    try {
      const response = await this.fetcher(this.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        throw new RPCError(`RPC call error: ${response.status}`);
      }
      const rpcResponse = await response.json();
      const updatedToken = this.parseSys(rpcResponse.sys, currentSeq);
      if (updatedToken) {
        if (preparedSession.isOverride) {
          this.sessionToken = updatedToken;
          this.sessionTokenOverride = updatedToken;
        } else if (preparedSession.isTemporary) {
        } else {
          this.sessionToken = updatedToken;
          if (this.onSessionTokenChanged) {
            this.onSessionTokenChanged(updatedToken);
          }
        }
      }
      if ("error" in rpcResponse && rpcResponse.error) {
        throw new RPCError(`RPC call error: ${rpcResponse.error}`);
      }
      if (!("result" in rpcResponse) || rpcResponse.result === void 0) {
        throw new RPCError("RPC response missing result");
      }
      return rpcResponse.result;
    } catch (error) {
      if (error instanceof RPCError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new RPCError(`RPC call failed: ${message}`);
    }
  }
}
function ensureSSOEnvironment() {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    throw new Error("AuthClient can only be created in browser SSO environments");
  }
}
class AuthClient {
  constructor(zoneBaseUrl, appId, options = {}) {
    ensureSSOEnvironment();
    this.zoneHostname = zoneBaseUrl;
    this.clientId = appId;
    this.navigate = options.navigate ?? ((url) => {
      window.location.assign(url);
    });
  }
  buildLoginURL(redirectUri = null) {
    ensureSSOEnvironment();
    const redirectTarget = redirectUri ?? window.location.href;
    const ssoURL = `${window.location.protocol}//sys.${this.zoneHostname}/login`;
    return `${ssoURL}?client_id=${this.clientId}&redirect_url=${encodeURIComponent(redirectTarget)}`;
  }
  async login(redirectUri = null) {
    const authURL = this.buildLoginURL(redirectUri);
    this.navigate(authURL);
  }
}
const LEGACY_ACCOUNT_STORAGE_KEY = "buckyos.account_info";
const BROWSER_USER_INFO_STORAGE_KEY = "user_info";
function getAccountStorageKey(appId) {
  return `buckyos.account_info.${appId}`;
}
function parseAccountInfo(raw) {
  if (raw == null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function parseBrowserUserInfo(raw) {
  if (raw == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const userId = typeof parsed.user_id === "string" ? parsed.user_id.trim() : "";
    const userType = typeof parsed.user_type === "string" ? parsed.user_type.trim() : "";
    const userNameCandidate = typeof parsed.user_name === "string" ? parsed.user_name.trim() : typeof parsed.show_name === "string" ? parsed.show_name.trim() : "";
    if (!userId || !userType) {
      return null;
    }
    return {
      user_name: userNameCandidate || userId,
      user_id: userId,
      user_type: userType
    };
  } catch {
    return null;
  }
}
function parseTokenAppId(sessionToken) {
  const parts = sessionToken.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    if (typeof payload.appid === "string" && payload.appid.trim().length > 0) {
      return payload.appid;
    }
  } catch {
    return null;
  }
  return null;
}
function hashPassword(username, password, nonce = null) {
  const shaObj = new ht("SHA-256", "TEXT", { encoding: "UTF8" });
  shaObj.update(password + username + ".buckyos");
  let org_password_hash_str = shaObj.getHash("B64");
  if (nonce == null) {
    return org_password_hash_str;
  }
  const shaObj2 = new ht("SHA-256", "TEXT", { encoding: "UTF8" });
  let salt = org_password_hash_str + nonce.toString();
  shaObj2.update(salt);
  let result = shaObj2.getHash("B64");
  return result;
}
function cleanLocalAccountInfo(appId) {
  localStorage.removeItem(getAccountStorageKey(appId));
  localStorage.removeItem(BROWSER_USER_INFO_STORAGE_KEY);
  const legacy = parseAccountInfo(localStorage.getItem(LEGACY_ACCOUNT_STORAGE_KEY));
  if ((legacy == null ? void 0 : legacy.session_token) && parseTokenAppId(legacy.session_token) === appId) {
    localStorage.removeItem(LEGACY_ACCOUNT_STORAGE_KEY);
  }
  let cookie_options = {
    path: "/",
    expires: /* @__PURE__ */ new Date(0),
    secure: true,
    sameSite: "Lax"
  };
  document.cookie = `${appId}_token=; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join("; ")}`;
}
function saveLocalAccountInfo(appId, account_info) {
  if (account_info.session_token == null) {
    console.error("session_token is null,can't save account info");
    return;
  }
  localStorage.setItem(getAccountStorageKey(appId), JSON.stringify(account_info));
  let cookie_options = {
    path: "/",
    expires: new Date(Date.now() + 1e3 * 60 * 60 * 24 * 30),
    // 30天
    secure: true,
    sameSite: "Lax"
  };
  document.cookie = `${appId}_token=${account_info.session_token}; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join("; ")}`;
}
function saveBrowserUserInfo(userInfo) {
  localStorage.setItem(BROWSER_USER_INFO_STORAGE_KEY, JSON.stringify(userInfo));
}
function getBrowserUserInfo() {
  return parseBrowserUserInfo(localStorage.getItem(BROWSER_USER_INFO_STORAGE_KEY));
}
class VerifyHubClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async loginByJwt(params) {
    this.rpcClient.resetSessionToken();
    const payload = {
      type: "jwt",
      jwt: params.jwt
    };
    if (params.login_params) {
      Object.assign(payload, params.login_params);
    }
    return this.rpcClient.call("login_by_jwt", payload);
  }
  async loginByPassword(params) {
    this.rpcClient.resetSessionToken();
    const payload = {
      type: "password",
      username: params.username,
      password: params.password,
      appid: params.appid
    };
    if (params.source_url) {
      payload.source_url = params.source_url;
    }
    return this.rpcClient.call("login_by_password", payload);
  }
  async refreshToken(params) {
    return this.rpcClient.call("refresh_token", params);
  }
  async verifyToken(params) {
    return this.rpcClient.call("verify_token", params);
  }
  static normalizeLoginResponse(response) {
    if ("user_info" in response) {
      return {
        user_name: response.user_info.show_name,
        user_id: response.user_info.user_id,
        user_type: response.user_info.user_type,
        session_token: response.session_token,
        refresh_token: response.refresh_token
      };
    }
    if (!response.session_token) {
      throw new RPCError("login_by_password response missing session_token");
    }
    return response;
  }
}
function parseTaskStatus(status) {
  switch (status) {
    case "Pending":
      return "Pending";
    case "Running":
      return "Running";
    case "Paused":
      return "Paused";
    case "Completed":
      return "Completed";
    case "Failed":
      return "Failed";
    case "Canceled":
      return "Canceled";
    case "WaitingForApproval":
      return "WaitingForApproval";
    default:
      throw new RPCError(`Invalid task status: ${status}`);
  }
}
function isTerminalTaskStatus(status) {
  return status === "Completed" || status === "Failed" || status === "Canceled";
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function asRecord$4(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError("Invalid RPC response format");
  }
  return value;
}
function parseTask(value) {
  const record = asRecord$4(value);
  const id = record.id;
  const status = record.status;
  if (typeof id !== "number") {
    throw new RPCError("Invalid task payload: missing id");
  }
  if (typeof status !== "string") {
    throw new RPCError("Invalid task payload: missing status");
  }
  return {
    ...record,
    status: parseTaskStatus(status)
  };
}
function parseTasks(value) {
  if (!Array.isArray(value)) {
    throw new RPCError("Invalid tasks payload: expected array");
  }
  return value.map((task) => parseTask(task));
}
function parseTaskListResult(value) {
  if (Array.isArray(value)) {
    return parseTasks(value);
  }
  const parsed = asRecord$4(value);
  if ("tasks" in parsed) {
    return parseTasks(parsed.tasks);
  }
  throw new RPCError("Expected tasks in response");
}
class TaskManagerClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async createTask(params) {
    const options = params.options ?? {};
    const req = {
      name: params.name,
      task_type: params.taskType,
      runner: options.runner ?? "",
      data: params.data,
      permissions: options.permissions,
      parent_id: options.parent_id,
      root_id: options.root_id,
      priority: options.priority,
      user_id: params.userId,
      app_id: params.appId,
      session_id: options.session_id,
      app_name: params.appId || void 0
    };
    const result = await this.rpcClient.call("create_task", req);
    const parsed = asRecord$4(result);
    if ("task" in parsed) {
      return parseTask(parsed.task);
    }
    const taskId = parsed.task_id;
    if (typeof taskId === "number") {
      return this.getTask(taskId);
    }
    throw new RPCError("Expected CreateTaskResult response");
  }
  async getTask(id) {
    const req = { id };
    const result = await this.rpcClient.call("get_task", req);
    const parsed = asRecord$4(result);
    if ("task" in parsed) {
      return parseTask(parsed.task);
    }
    return parseTask(result);
  }
  async waitForTaskEnd(id) {
    return this.waitForTaskEndWithInterval(id, 500);
  }
  async waitForTaskEndWithInterval(id, pollIntervalMs) {
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new RPCError("pollIntervalMs must be greater than 0");
    }
    while (true) {
      const task = await this.getTask(id);
      if (isTerminalTaskStatus(task.status)) {
        return task.status;
      }
      await sleep(pollIntervalMs);
    }
  }
  async listTasks(params = {}) {
    const filter = params.filter ?? {};
    const req = {
      app_id: filter.app_id,
      session_id: filter.session_id,
      task_type: filter.task_type,
      runner: filter.runner,
      status: filter.status,
      parent_id: filter.parent_id,
      root_id: filter.root_id,
      source_user_id: params.sourceUserId,
      source_app_id: params.sourceAppId
    };
    const result = await this.rpcClient.call("list_tasks", req);
    return parseTaskListResult(result);
  }
  async listTasksByTimeRange(params) {
    const req = {
      app_id: params.appId,
      session_id: params.sessionId,
      task_type: params.taskType,
      source_user_id: params.sourceUserId,
      source_app_id: params.sourceAppId,
      start_time: params.startTime,
      end_time: params.endTime
    };
    const result = await this.rpcClient.call("list_tasks_by_time_range", req);
    return parseTaskListResult(result);
  }
  async updateTask(payload) {
    const req = {
      id: payload.id,
      status: payload.status,
      progress: payload.progress,
      message: payload.message,
      data: payload.data
    };
    await this.rpcClient.call("update_task", req);
  }
  async cancelTask(id, recursive = false) {
    const req = { id, recursive };
    await this.rpcClient.call("cancel_task", req);
  }
  async getSubtasks(parentId) {
    const req = { parent_id: parentId };
    const result = await this.rpcClient.call("get_subtasks", req);
    return parseTaskListResult(result);
  }
  async updateTaskStatus(id, status) {
    const req = { id, status };
    await this.rpcClient.call("update_task_status", req);
  }
  async updateTaskProgress(id, completedItems, totalItems) {
    const req = {
      id,
      completed_items: completedItems,
      total_items: totalItems
    };
    await this.rpcClient.call("update_task_progress", req);
  }
  async updateTaskError(id, errorMessage) {
    const req = { id, error_message: errorMessage };
    await this.rpcClient.call("update_task_error", req);
  }
  async updateTaskData(id, data) {
    const req = { id, data };
    await this.rpcClient.call("update_task_data", req);
  }
  async deleteTask(id) {
    const req = { id };
    await this.rpcClient.call("delete_task", req);
  }
  async deleteTasksBySession(sessionId, options = {}) {
    const req = {
      session_id: sessionId,
      source_user_id: options.sourceUserId,
      source_app_id: options.sourceAppId
    };
    const result = await this.rpcClient.call("delete_tasks_by_session", req);
    const parsed = asRecord$4(result);
    const deletedCount = parsed.deleted_count;
    if (typeof deletedCount !== "number") {
      throw new RPCError("Expected DeleteTasksResult response");
    }
    return deletedCount;
  }
  async createDownloadTask(downloadUrl, userId, appId, options = {}, objid, downloadOptions) {
    const req = {
      download_url: downloadUrl,
      objid,
      download_options: downloadOptions,
      parent_id: options.parent_id,
      permissions: options.permissions,
      root_id: options.root_id,
      runner: options.runner,
      priority: options.priority,
      user_id: userId,
      app_id: appId,
      session_id: options.session_id,
      app_name: appId || void 0
    };
    const result = await this.rpcClient.call("create_download_task", req);
    const parsed = asRecord$4(result);
    const taskId = parsed.task_id;
    if (typeof taskId !== "number") {
      throw new RPCError("Expected CreateDownloadTaskResult response");
    }
    return taskId;
  }
  async pauseTask(id) {
    await this.updateTaskStatus(
      id,
      "Paused"
      /* Paused */
    );
  }
  async resumeTask(id) {
    await this.updateTaskStatus(
      id,
      "Running"
      /* Running */
    );
  }
  async completeTask(id) {
    await this.updateTaskStatus(
      id,
      "Completed"
      /* Completed */
    );
  }
  async markTaskAsWaitingForApproval(id) {
    await this.updateTaskStatus(
      id,
      "WaitingForApproval"
      /* WaitingForApproval */
    );
  }
  async markTaskAsFailed(id, errorMessage) {
    await this.updateTaskError(id, errorMessage);
    await this.updateTaskStatus(
      id,
      "Failed"
      /* Failed */
    );
  }
  async pauseAllRunningTasks(options = {}) {
    const runningTasks = await this.listTasks({
      filter: {
        status: "Running"
        /* Running */
      },
      sourceUserId: options.sourceUserId,
      sourceAppId: options.sourceAppId
    });
    for (const task of runningTasks) {
      await this.pauseTask(task.id);
    }
  }
  async resumeLastPausedTask(options = {}) {
    const pausedTasks = await this.listTasks({
      filter: {
        status: "Paused"
        /* Paused */
      },
      sourceUserId: options.sourceUserId,
      sourceAppId: options.sourceAppId
    });
    const lastPausedTask = pausedTasks[pausedTasks.length - 1];
    if (!lastPausedTask) {
      throw new RPCError("No paused tasks found");
    }
    await this.resumeTask(lastPausedTask.id);
  }
}
const WORKFLOW_SERVICE_NAME = "workflow";
var WorkflowStepType = /* @__PURE__ */ ((WorkflowStepType2) => {
  WorkflowStepType2["Autonomous"] = "autonomous";
  WorkflowStepType2["HumanConfirm"] = "human_confirm";
  WorkflowStepType2["HumanRequired"] = "human_required";
  return WorkflowStepType2;
})(WorkflowStepType || {});
var WorkflowOutputMode = /* @__PURE__ */ ((WorkflowOutputMode2) => {
  WorkflowOutputMode2["Single"] = "single";
  WorkflowOutputMode2["FiniteSeekable"] = "finite_seekable";
  WorkflowOutputMode2["FiniteSequential"] = "finite_sequential";
  return WorkflowOutputMode2;
})(WorkflowOutputMode || {});
var WorkflowJoinMode = /* @__PURE__ */ ((WorkflowJoinMode2) => {
  WorkflowJoinMode2["All"] = "all";
  WorkflowJoinMode2["Any"] = "any";
  WorkflowJoinMode2["NOfM"] = "n_of_m";
  return WorkflowJoinMode2;
})(WorkflowJoinMode || {});
var WorkflowRetryFallback = /* @__PURE__ */ ((WorkflowRetryFallback2) => {
  WorkflowRetryFallback2["Human"] = "human";
  WorkflowRetryFallback2["Abort"] = "abort";
  return WorkflowRetryFallback2;
})(WorkflowRetryFallback || {});
var WorkflowDefinitionStatus = /* @__PURE__ */ ((WorkflowDefinitionStatus2) => {
  WorkflowDefinitionStatus2["Draft"] = "draft";
  WorkflowDefinitionStatus2["Active"] = "active";
  WorkflowDefinitionStatus2["Archived"] = "archived";
  return WorkflowDefinitionStatus2;
})(WorkflowDefinitionStatus || {});
var WorkflowRunStatus = /* @__PURE__ */ ((WorkflowRunStatus2) => {
  WorkflowRunStatus2["Created"] = "created";
  WorkflowRunStatus2["Running"] = "running";
  WorkflowRunStatus2["WaitingHuman"] = "waiting_human";
  WorkflowRunStatus2["Completed"] = "completed";
  WorkflowRunStatus2["Failed"] = "failed";
  WorkflowRunStatus2["Paused"] = "paused";
  WorkflowRunStatus2["Aborted"] = "aborted";
  WorkflowRunStatus2["BudgetExhausted"] = "budget_exhausted";
  return WorkflowRunStatus2;
})(WorkflowRunStatus || {});
var WorkflowNodeRunState = /* @__PURE__ */ ((WorkflowNodeRunState2) => {
  WorkflowNodeRunState2["Pending"] = "pending";
  WorkflowNodeRunState2["Ready"] = "ready";
  WorkflowNodeRunState2["Running"] = "running";
  WorkflowNodeRunState2["Completed"] = "completed";
  WorkflowNodeRunState2["Failed"] = "failed";
  WorkflowNodeRunState2["Retrying"] = "retrying";
  WorkflowNodeRunState2["WaitingHuman"] = "waiting_human";
  WorkflowNodeRunState2["Skipped"] = "skipped";
  WorkflowNodeRunState2["Aborted"] = "aborted";
  WorkflowNodeRunState2["Cancelled"] = "cancelled";
  return WorkflowNodeRunState2;
})(WorkflowNodeRunState || {});
var WorkflowHumanActionKind = /* @__PURE__ */ ((WorkflowHumanActionKind2) => {
  WorkflowHumanActionKind2["Approve"] = "approve";
  WorkflowHumanActionKind2["Modify"] = "modify";
  WorkflowHumanActionKind2["Reject"] = "reject";
  WorkflowHumanActionKind2["Retry"] = "retry";
  WorkflowHumanActionKind2["Skip"] = "skip";
  WorkflowHumanActionKind2["Abort"] = "abort";
  WorkflowHumanActionKind2["Rollback"] = "rollback";
  return WorkflowHumanActionKind2;
})(WorkflowHumanActionKind || {});
var WorkflowScheduledTaskStatus = /* @__PURE__ */ ((WorkflowScheduledTaskStatus2) => {
  WorkflowScheduledTaskStatus2["Enabled"] = "enabled";
  WorkflowScheduledTaskStatus2["Paused"] = "paused";
  WorkflowScheduledTaskStatus2["Archived"] = "archived";
  WorkflowScheduledTaskStatus2["Error"] = "error";
  return WorkflowScheduledTaskStatus2;
})(WorkflowScheduledTaskStatus || {});
var WorkflowScheduledTaskMisfirePolicy = /* @__PURE__ */ ((WorkflowScheduledTaskMisfirePolicy2) => {
  WorkflowScheduledTaskMisfirePolicy2["Skip"] = "skip";
  WorkflowScheduledTaskMisfirePolicy2["RunOnce"] = "run_once";
  WorkflowScheduledTaskMisfirePolicy2["CatchUp"] = "catch_up";
  WorkflowScheduledTaskMisfirePolicy2["Manual"] = "manual";
  return WorkflowScheduledTaskMisfirePolicy2;
})(WorkflowScheduledTaskMisfirePolicy || {});
var WorkflowScheduledTaskFireStatus = /* @__PURE__ */ ((WorkflowScheduledTaskFireStatus2) => {
  WorkflowScheduledTaskFireStatus2["Created"] = "created";
  WorkflowScheduledTaskFireStatus2["TaskCreated"] = "task_created";
  WorkflowScheduledTaskFireStatus2["Skipped"] = "skipped";
  WorkflowScheduledTaskFireStatus2["Failed"] = "failed";
  return WorkflowScheduledTaskFireStatus2;
})(WorkflowScheduledTaskFireStatus || {});
function asRecord$3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError("Invalid workflow RPC response format");
  }
  return value;
}
function requiredField(record, field) {
  if (!(field in record)) {
    throw new RPCError(`Expected ${field} in workflow response`);
  }
  return record[field];
}
class WorkflowClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async callOk(method, params) {
    const result = await this.rpcClient.call(method, params);
    const parsed = asRecord$3(result);
    if (parsed.ok === true) {
      return parsed;
    }
    const message = typeof parsed.message === "string" ? parsed.message : typeof parsed.error === "string" ? parsed.error : "workflow request failed";
    throw new RPCError(message);
  }
  async submitDefinition(request) {
    const result = await this.callOk("submit_definition", request);
    return {
      workflow_id: requiredField(result, "workflow_id"),
      version: requiredField(result, "version"),
      analysis: requiredField(result, "analysis"),
      definition: requiredField(result, "definition")
    };
  }
  async getDefinition(workflowId) {
    const result = await this.callOk("get_definition", { workflow_id: workflowId });
    return requiredField(result, "definition");
  }
  async listDefinitions(request = {}) {
    const result = await this.callOk("list_definitions", request);
    return requiredField(result, "definitions");
  }
  async archiveDefinition(workflowId) {
    const result = await this.callOk("archive_definition", { workflow_id: workflowId });
    return requiredField(result, "status");
  }
  async dryRun(definition) {
    const result = await this.callOk("dry_run", { definition });
    return {
      analysis: requiredField(result, "analysis"),
      graph: requiredField(result, "graph")
    };
  }
  async createRun(request) {
    return await this.callOk("create_run", request);
  }
  async startRun(runId) {
    return await this.callOk("start_run", { run_id: runId });
  }
  async tickRun(runId) {
    return await this.callOk("tick_run", { run_id: runId });
  }
  async getRunGraph(runId) {
    return await this.callOk("get_run_graph", { run_id: runId });
  }
  async listRuns(request = {}) {
    const result = await this.callOk("list_runs", request);
    return requiredField(result, "runs");
  }
  async submitStepOutput(request) {
    return await this.callOk("submit_step_output", request);
  }
  async reportStepProgress(request) {
    return await this.callOk("report_step_progress", request);
  }
  async requestHuman(request) {
    return await this.callOk("request_human", request);
  }
  async submitAmendment(request) {
    const result = await this.callOk("submit_amendment", request);
    return requiredField(result, "amendment");
  }
  async approveAmendment(request) {
    const result = await this.callOk("approve_amendment", request);
    return {
      amendment: requiredField(result, "amendment"),
      plan_version: requiredField(result, "plan_version")
    };
  }
  async rejectAmendment(request) {
    const result = await this.callOk("reject_amendment", request);
    return {
      amendment: requiredField(result, "amendment"),
      plan_version: requiredField(result, "plan_version")
    };
  }
  async getHistory(request) {
    return await this.callOk("get_history", request);
  }
  async subscribeEvents(request) {
    return await this.callOk("subscribe_events", request);
  }
  async createScheduledTask(request) {
    const result = await this.callOk("create_scheduled_task", request);
    return requiredField(result, "schedule");
  }
  async updateScheduledTask(request) {
    const result = await this.callOk("update_scheduled_task", request);
    return requiredField(result, "schedule");
  }
  async getScheduledTask(scheduleId) {
    const result = await this.callOk("get_scheduled_task", { schedule_id: scheduleId });
    return requiredField(result, "schedule");
  }
  async listScheduledTasks(request = {}) {
    const result = await this.callOk("list_scheduled_tasks", request);
    return requiredField(result, "schedules");
  }
  async pauseScheduledTask(scheduleId) {
    const result = await this.callOk("pause_scheduled_task", { schedule_id: scheduleId });
    return requiredField(result, "schedule");
  }
  async resumeScheduledTask(scheduleId) {
    const result = await this.callOk("resume_scheduled_task", { schedule_id: scheduleId });
    return requiredField(result, "schedule");
  }
  async archiveScheduledTask(scheduleId) {
    const result = await this.callOk("archive_scheduled_task", { schedule_id: scheduleId });
    return requiredField(result, "schedule");
  }
  async runScheduledTaskNow(request) {
    const result = await this.callOk("run_scheduled_task_now", request);
    return requiredField(result, "fire");
  }
  async getScheduledTaskHistory(request) {
    const result = await this.callOk("get_scheduled_task_history", request);
    return requiredField(result, "fires");
  }
  async validateScheduledTask(request) {
    return await this.callOk("validate_scheduled_task", request);
  }
}
const CONFIG_CACHE_TIME_SECONDS = 10;
const CACHE_KEY_PREFIXES = ["services/", "system/rbac/"];
class SystemConfigClient {
  constructor(serviceUrl, sessionToken = null, options = {}) {
    this.configCache = /* @__PURE__ */ new Map();
    this.rpcClient = new kRPCClient(serviceUrl, sessionToken, null, options);
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async syncSessionToken(token) {
    this.rpcClient.setSessionToken(token);
  }
  getSessionToken() {
    return this.rpcClient.getSessionToken();
  }
  needCache(key) {
    return CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  }
  getUnixTimestamp() {
    return Math.floor(Date.now() / 1e3);
  }
  getConfigCache(key) {
    const cached = this.configCache.get(key);
    if (!cached) {
      return null;
    }
    if (cached.cachedAt + CONFIG_CACHE_TIME_SECONDS < this.getUnixTimestamp()) {
      this.configCache.delete(key);
      return null;
    }
    return cached;
  }
  setConfigCache(key, value, version) {
    if (!this.needCache(key)) {
      return true;
    }
    const previous = this.configCache.get(key);
    this.configCache.set(key, {
      value,
      version,
      cachedAt: this.getUnixTimestamp()
    });
    if (!previous) {
      return true;
    }
    return previous.value !== value || previous.version !== version;
  }
  removeConfigCache(key) {
    this.configCache.delete(key);
  }
  async get(key) {
    const cachedValue = this.getConfigCache(key);
    if (cachedValue != null) {
      return {
        value: cachedValue.value,
        version: cachedValue.version,
        is_changed: false
      };
    }
    const result = await this.rpcClient.call("sys_config_get", { key });
    if (result == null) {
      throw new Error(`system_config key not found: ${key}`);
    }
    if (typeof result.value !== "string" || typeof result.version !== "number") {
      throw new Error(`invalid sys_config_get response for key: ${key}`);
    }
    const isChanged = this.setConfigCache(key, result.value, result.version);
    return {
      value: result.value,
      version: result.version,
      is_changed: isChanged
    };
  }
  async set(key, value) {
    if (!key || !value) {
      throw new Error("key or value is empty");
    }
    if (key.includes(":")) {
      throw new Error("key can not contain ':'");
    }
    await this.rpcClient.call("sys_config_set", { key, value });
    this.removeConfigCache(key);
    return 0;
  }
  async setByJsonPath(key, jsonPath, value) {
    await this.rpcClient.call(
      "sys_config_set_by_json_path",
      { key, json_path: jsonPath, value }
    );
    this.removeConfigCache(key);
    return 0;
  }
  async create(key, value) {
    await this.rpcClient.call("sys_config_create", { key, value });
    this.removeConfigCache(key);
    return 0;
  }
  async delete(key) {
    await this.rpcClient.call("sys_config_delete", { key });
    this.removeConfigCache(key);
    return 0;
  }
  async append(key, value) {
    await this.rpcClient.call("sys_config_append", {
      key,
      append_value: value
    });
    this.removeConfigCache(key);
    return 0;
  }
  async list(key) {
    return this.rpcClient.call("sys_config_list", { key });
  }
  async execTx(actions, mainKey) {
    const params = { actions };
    if (mainKey) {
      params.main_key = `${mainKey[0]}:${mainKey[1]}`;
    }
    await this.rpcClient.call("sys_config_exec_tx", params);
    for (const key of Object.keys(actions)) {
      this.removeConfigCache(key);
    }
    return 0;
  }
  async dumpConfigsForScheduler() {
    return this.rpcClient.call("dump_configs_for_scheduler", {});
  }
  async refreshTrustKeys() {
    await this.rpcClient.call("sys_refresh_trust_keys", {});
  }
}
const AICC_SERVICE_NAME = "aicc";
const AICC_SERVICE_UNIQUE_ID = "aicc";
const AICC_SERVICE_SERVICE_NAME = AICC_SERVICE_NAME;
const AICC_SERVICE_SERVICE_PORT = 4040;
const AICC_AI_METHODS = {
  LLM_CHAT: "llm.chat",
  LLM_COMPLETION: "llm.completion",
  EMBEDDING_TEXT: "embedding.text",
  EMBEDDING_MULTIMODAL: "embedding.multimodal",
  RERANK: "rerank",
  IMAGE_TXT2IMG: "image.txt2img",
  IMAGE_IMG2IMG: "image.img2img",
  IMAGE_INPAINT: "image.inpaint",
  IMAGE_UPSCALE: "image.upscale",
  IMAGE_BG_REMOVE: "image.bg_remove",
  VISION_OCR: "vision.ocr",
  VISION_CAPTION: "vision.caption",
  VISION_DETECT: "vision.detect",
  VISION_SEGMENT: "vision.segment",
  AUDIO_TTS: "audio.tts",
  AUDIO_ASR: "audio.asr",
  AUDIO_MUSIC: "audio.music",
  AUDIO_ENHANCE: "audio.enhance",
  VIDEO_TXT2VIDEO: "video.txt2video",
  VIDEO_IMG2VIDEO: "video.img2video",
  VIDEO_VIDEO2VIDEO: "video.video2video",
  VIDEO_EXTEND: "video.extend",
  VIDEO_UPSCALE: "video.upscale",
  AGENT_COMPUTER_USE: "agent.computer_use"
};
const AICC_CONTROL_METHODS = {
  CANCEL: "cancel",
  RELOAD_SETTINGS: "reload_settings",
  SERVICE_RELOAD_SETTINGS: "service.reload_settings",
  QUOTA_QUERY: "quota.query",
  PROVIDER_LIST: "provider.list",
  PROVIDER_HEALTH: "provider.health"
};
const AICC_FEATURES = {
  PLAN: "plan",
  TOOL_CALLING: "tool_calling",
  JSON_OUTPUT: "json_output",
  WEB_SEARCH: "web_search",
  VISION: "vision",
  ASR: "asr",
  VIDEO_UNDERSTAND: "video_understand"
};
const AI_METHOD_SET = new Set(Object.values(AICC_AI_METHODS));
const CAPABILITY_SET = /* @__PURE__ */ new Set(["llm", "embedding", "rerank", "image", "vision", "audio", "video", "agent"]);
const METHOD_STATUS_SET = /* @__PURE__ */ new Set(["succeeded", "running", "failed"]);
const AI_ROLE_SET = /* @__PURE__ */ new Set(["system", "user", "assistant", "tool", "developer"]);
const NON_TEXT_BLOCK_ESTIMATED_LEN = 256;
function isAiccAiMethod(method) {
  return AI_METHOD_SET.has(method);
}
function aiccTextMessage(role, text) {
  return { role, content: [{ type: "text", text }] };
}
function aiccMessageTextContent(message) {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}
function aiccMessageFirstText(message) {
  var _a;
  return (_a = message.content.find((block) => block.type === "text")) == null ? void 0 : _a.text;
}
function aiccResponseTextContent(response) {
  return aiccMessageTextContent(response.message);
}
function aiccResponseToolCalls(response) {
  return response.message.content.filter((block) => block.type === "tool_use").map((block) => ({
    name: block.name,
    args: block.args,
    call_id: block.call_id
  }));
}
function aiccResponseArtifacts(response) {
  const artifacts = [];
  response.message.content.forEach((block, index) => {
    if (block.type === "image") {
      artifacts.push({
        name: `image_${index + 1}`,
        resource: block.source,
        mime: aiccResourceRefMime(block.source)
      });
    }
    if (block.type === "document") {
      artifacts.push({
        name: block.title ?? `document_${index + 1}`,
        resource: block.source,
        mime: aiccResourceRefMime(block.source)
      });
    }
  });
  return artifacts;
}
function aiccRenderMessageForDebug(message) {
  return message.content.map(renderAiccContentForDebug).join("");
}
function aiccEstimateMessageTextLen(message) {
  return message.content.reduce((total, block) => {
    var _a, _b;
    if (block.type === "text") {
      return total + block.text.length;
    }
    if (block.type === "thinking") {
      return total + (((_a = block.summary) == null ? void 0 : _a.length) ?? 0) + (((_b = block.text) == null ? void 0 : _b.length) ?? 0);
    }
    return total + NON_TEXT_BLOCK_ESTIMATED_LEN;
  }, 0);
}
function validateAiccMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new RPCError("AiccMessage must be an object");
  }
  if (!AI_ROLE_SET.has(message.role)) {
    throw new RPCError(`AiccMessage.role is invalid: ${String(message.role)}`);
  }
  if (!Array.isArray(message.content)) {
    throw new RPCError("AiccMessage.content must be an array of content blocks");
  }
  for (const block of message.content) {
    validateAiccContentBlockForRole(message.role, block);
  }
}
function validateAiccMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new RPCError("AiccLlmChatInput.messages must be an array");
  }
  for (const message of messages) {
    validateAiccMessage(message);
  }
}
function validateAiccResponse(response) {
  const record = asRecord$2(response);
  for (const key of ["text", "tool_calls", "artifacts"]) {
    if (key in record) {
      throw new RPCError(`AiccResponse.${key} is no longer supported; use AiccResponse.message`);
    }
  }
  if (!record.message) {
    throw new RPCError("AiccResponse.message is required");
  }
  validateAiccMessage(record.message);
  if (record.message.role !== "assistant") {
    throw new RPCError("AiccResponse.message.role must be assistant");
  }
}
function renderAiccContentForDebug(block) {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return "[image]";
    case "document":
      return block.title ? `[document title=${block.title}]` : "[document]";
    case "tool_use":
      return `[tool_use name=${block.name} call_id=${block.call_id}]`;
    case "tool_result":
      return `[tool_result call_id=${block.call_id}${block.is_error ? " is_error=true" : ""}]`;
    case "thinking":
      return block.text ?? block.summary ?? "[thinking]";
    case "provider_state":
      return `[provider_state provider=${block.provider}]`;
  }
}
function aiccResourceRefMime(resource) {
  switch (resource.kind) {
    case "url":
      return resource.mime_hint ?? null;
    case "base64":
      return resource.mime;
    case "named_object":
      return null;
  }
}
function validateAiccContentBlockForRole(role, block) {
  if (!block || typeof block !== "object" || !("type" in block) || typeof block.type !== "string") {
    throw new RPCError(`AiccMessage contains an invalid content block for role ${role}`);
  }
  if (!isBlockAllowedForRole(role, block.type)) {
    throw new RPCError(`AiccMessage role ${role} cannot contain ${block.type} content`);
  }
  if ((block.type === "tool_use" || block.type === "tool_result") && !block.call_id) {
    throw new RPCError(`AiccContent.${block.type} requires call_id`);
  }
  if (block.type === "tool_use" && !block.name) {
    throw new RPCError("AiccContent.tool_use requires name");
  }
  if (block.type === "tool_result" && (!Array.isArray(block.content) || block.content.length === 0)) {
    throw new RPCError("AiccContent.tool_result requires non-empty content");
  }
  if (block.type === "tool_result") {
    for (const item of block.content) {
      validateAiccToolResultContent(item);
    }
  }
  if (block.type === "provider_state" && !block.provider) {
    throw new RPCError("AiccContent.provider_state requires provider");
  }
}
function validateAiccToolResultContent(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new RPCError("AiccToolResultContent must be an object");
  }
  switch (content.type) {
    case "text":
      if (typeof content.text !== "string") {
        throw new RPCError("AiccToolResultContent.text requires text");
      }
      return;
    case "image":
      if (!content.source) {
        throw new RPCError("AiccToolResultContent.image requires source");
      }
      return;
    case "document":
      if (!content.source) {
        throw new RPCError("AiccToolResultContent.document requires source");
      }
      return;
    default:
      throw new RPCError(`AiccToolResultContent type is invalid: ${String(content.type)}`);
  }
}
function isBlockAllowedForRole(role, blockType) {
  switch (role) {
    case "system":
    case "developer":
      return blockType === "text";
    case "user":
      return blockType === "text" || blockType === "image" || blockType === "document";
    case "assistant":
      return blockType === "text" || blockType === "image" || blockType === "document" || blockType === "tool_use" || blockType === "thinking" || blockType === "provider_state";
    case "tool":
      return blockType === "tool_result";
  }
}
function asRecord$2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError("Invalid RPC response format");
  }
  return value;
}
function rejectDeprecatedRequestFields(request) {
  const requirements = request.requirements;
  if ("resp_foramt" in requirements) {
    throw new RPCError("AiccRequirements.resp_foramt is no longer supported; use resp_format");
  }
  const payload = request.payload;
  for (const key of ["text", "messages", "tool_specs"]) {
    if (key in payload) {
      throw new RPCError(`AiccPayload.${key} is no longer supported; put method fields under payload.input_json`);
    }
  }
}
function normalizeMethodRequest(request) {
  if (!request.capability || !CAPABILITY_SET.has(request.capability)) {
    throw new RPCError("AiccMethodRequest.capability is invalid");
  }
  if (!request.model || !request.model.alias) {
    throw new RPCError("AiccMethodRequest.model.alias is required");
  }
  if (!request.requirements || typeof request.requirements !== "object") {
    throw new RPCError("AiccMethodRequest.requirements is required");
  }
  if (!request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) {
    throw new RPCError("AiccMethodRequest.payload is required");
  }
  rejectDeprecatedRequestFields(request);
  return {
    ...request,
    payload: {
      input_json: request.payload.input_json ?? {},
      resources: request.payload.resources ?? [],
      options: request.payload.options ?? {}
    }
  };
}
function validateLlmChatPayload(request) {
  const input = request.payload.input_json;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RPCError("AiccLlmChatInput must be an object");
  }
  const messages = input.messages;
  validateAiccMessages(messages);
}
function parseMethodResponse(result) {
  const record = asRecord$2(result);
  if (typeof record.task_id !== "string") {
    throw new RPCError("AiccMethodResponse missing task_id");
  }
  if (typeof record.status !== "string" || !METHOD_STATUS_SET.has(record.status)) {
    throw new RPCError("AiccMethodResponse missing or invalid status");
  }
  if (record.result != null) {
    validateAiccResponse(record.result);
  }
  return record;
}
function normalizeModel(model) {
  if (typeof model === "string") {
    return { alias: model };
  }
  return model;
}
function buildTypedMethodRequest(capability, request) {
  return {
    capability,
    model: normalizeModel(request.model),
    requirements: request.requirements ?? {},
    payload: {
      input_json: request.input,
      resources: request.resources ?? [],
      options: request.options ?? {}
    },
    policy: request.policy,
    idempotency_key: request.idempotency_key,
    task_options: request.task_options
  };
}
class AiccClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async callMethod(method, request) {
    if (!isAiccAiMethod(method)) {
      throw new RPCError(`Unknown AICC AI method: ${method}`);
    }
    const normalizedRequest = normalizeMethodRequest(request);
    if (method === AICC_AI_METHODS.LLM_CHAT) {
      validateLlmChatPayload(normalizedRequest);
    }
    const result = await this.rpcClient.call(method, normalizedRequest);
    return parseMethodResponse(result);
  }
  async llmChat(request) {
    return this.callMethod(AICC_AI_METHODS.LLM_CHAT, buildTypedMethodRequest("llm", request));
  }
  async llmCompletion(request) {
    return this.callMethod(AICC_AI_METHODS.LLM_COMPLETION, buildTypedMethodRequest("llm", request));
  }
  async embeddingText(request) {
    return this.callMethod(AICC_AI_METHODS.EMBEDDING_TEXT, buildTypedMethodRequest("embedding", request));
  }
  async embeddingMultimodal(request) {
    return this.callMethod(
      AICC_AI_METHODS.EMBEDDING_MULTIMODAL,
      buildTypedMethodRequest("embedding", request)
    );
  }
  async rerank(request) {
    return this.callMethod(AICC_AI_METHODS.RERANK, buildTypedMethodRequest("rerank", request));
  }
  async imageTxt2img(request) {
    return this.callMethod(AICC_AI_METHODS.IMAGE_TXT2IMG, buildTypedMethodRequest("image", request));
  }
  async imageImg2img(request) {
    return this.callMethod(AICC_AI_METHODS.IMAGE_IMG2IMG, buildTypedMethodRequest("image", request));
  }
  async imageInpaint(request) {
    return this.callMethod(AICC_AI_METHODS.IMAGE_INPAINT, buildTypedMethodRequest("image", request));
  }
  async imageUpscale(request) {
    return this.callMethod(AICC_AI_METHODS.IMAGE_UPSCALE, buildTypedMethodRequest("image", request));
  }
  async imageBgRemove(request) {
    return this.callMethod(AICC_AI_METHODS.IMAGE_BG_REMOVE, buildTypedMethodRequest("image", request));
  }
  async visionOcr(request) {
    return this.callMethod(AICC_AI_METHODS.VISION_OCR, buildTypedMethodRequest("vision", request));
  }
  async visionCaption(request) {
    return this.callMethod(AICC_AI_METHODS.VISION_CAPTION, buildTypedMethodRequest("vision", request));
  }
  async visionDetect(request) {
    return this.callMethod(AICC_AI_METHODS.VISION_DETECT, buildTypedMethodRequest("vision", request));
  }
  async visionSegment(request) {
    return this.callMethod(AICC_AI_METHODS.VISION_SEGMENT, buildTypedMethodRequest("vision", request));
  }
  async audioTts(request) {
    return this.callMethod(AICC_AI_METHODS.AUDIO_TTS, buildTypedMethodRequest("audio", request));
  }
  async audioAsr(request) {
    return this.callMethod(AICC_AI_METHODS.AUDIO_ASR, buildTypedMethodRequest("audio", request));
  }
  async audioMusic(request) {
    return this.callMethod(AICC_AI_METHODS.AUDIO_MUSIC, buildTypedMethodRequest("audio", request));
  }
  async audioEnhance(request) {
    return this.callMethod(AICC_AI_METHODS.AUDIO_ENHANCE, buildTypedMethodRequest("audio", request));
  }
  async videoTxt2video(request) {
    return this.callMethod(AICC_AI_METHODS.VIDEO_TXT2VIDEO, buildTypedMethodRequest("video", request));
  }
  async videoImg2video(request) {
    return this.callMethod(AICC_AI_METHODS.VIDEO_IMG2VIDEO, buildTypedMethodRequest("video", request));
  }
  async videoVideo2video(request) {
    return this.callMethod(AICC_AI_METHODS.VIDEO_VIDEO2VIDEO, buildTypedMethodRequest("video", request));
  }
  async videoExtend(request) {
    return this.callMethod(AICC_AI_METHODS.VIDEO_EXTEND, buildTypedMethodRequest("video", request));
  }
  async videoUpscale(request) {
    return this.callMethod(AICC_AI_METHODS.VIDEO_UPSCALE, buildTypedMethodRequest("video", request));
  }
  async agentComputerUse(request) {
    return this.callMethod(AICC_AI_METHODS.AGENT_COMPUTER_USE, buildTypedMethodRequest("agent", request));
  }
  async cancel(taskId) {
    if (!taskId) {
      throw new RPCError("AiccClient.cancel requires a non-empty task_id");
    }
    const result = await this.rpcClient.call(AICC_CONTROL_METHODS.CANCEL, { task_id: taskId });
    const record = asRecord$2(result);
    if (typeof record.task_id !== "string" || typeof record.accepted !== "boolean") {
      throw new RPCError("Invalid cancel response");
    }
    return { task_id: record.task_id, accepted: record.accepted };
  }
  async reloadSettings() {
    return this.rpcClient.call(AICC_CONTROL_METHODS.RELOAD_SETTINGS, {});
  }
  async serviceReloadSettings() {
    return this.rpcClient.call(AICC_CONTROL_METHODS.SERVICE_RELOAD_SETTINGS, {});
  }
  async queryQuota(request) {
    const result = await this.rpcClient.call(AICC_CONTROL_METHODS.QUOTA_QUERY, request);
    const record = asRecord$2(result);
    if (!record.quota || typeof record.quota !== "object" || Array.isArray(record.quota)) {
      throw new RPCError("Invalid quota.query response");
    }
    return record;
  }
  async listProviders(request = {}) {
    return this.rpcClient.call(AICC_CONTROL_METHODS.PROVIDER_LIST, request);
  }
  async providerHealth(request) {
    return this.rpcClient.call(AICC_CONTROL_METHODS.PROVIDER_HEALTH, request);
  }
}
const DEFAULT_QUEUE_CONFIG = {
  max_messages: null,
  retention_seconds: null,
  sync_write: false,
  other_app_can_read: true,
  other_app_can_write: false,
  other_user_can_read: false,
  other_user_can_write: false
};
function asNumber$1(value, what) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RPCError(`expected ${what} to be a number`);
  }
  return value;
}
function asString$1(value, what) {
  if (typeof value !== "string") {
    throw new RPCError(`expected ${what} to be a string`);
  }
  return value;
}
function asMessageList(value) {
  if (!Array.isArray(value)) {
    throw new RPCError("expected message list to be an array");
  }
  return value.map((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RPCError(`message[${idx}] is not an object`);
    }
    const record = entry;
    return {
      index: asNumber$1(record.index, `message[${idx}].index`),
      created_at: asNumber$1(record.created_at, `message[${idx}].created_at`),
      payload: Array.isArray(record.payload) ? record.payload : [],
      headers: record.headers && typeof record.headers === "object" && !Array.isArray(record.headers) ? record.headers : {}
    };
  });
}
class MsgQueueClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async createQueue(name, appid, appOwner, config = { ...DEFAULT_QUEUE_CONFIG }) {
    const result = await this.rpcClient.call("create_queue", {
      name,
      appid,
      app_owner: appOwner,
      config
    });
    return asString$1(result, "queue_urn");
  }
  async deleteQueue(queueUrn) {
    await this.rpcClient.call("delete_queue", {
      queue_urn: queueUrn
    });
  }
  async getQueueStats(queueUrn) {
    const result = await this.rpcClient.call("get_queue_stats", {
      queue_urn: queueUrn
    });
    if (!result || typeof result !== "object") {
      throw new RPCError("invalid get_queue_stats response");
    }
    const record = result;
    return {
      message_count: asNumber$1(record.message_count, "message_count"),
      first_index: asNumber$1(record.first_index, "first_index"),
      last_index: asNumber$1(record.last_index, "last_index"),
      size_bytes: asNumber$1(record.size_bytes, "size_bytes")
    };
  }
  async updateQueueConfig(queueUrn, config) {
    await this.rpcClient.call(
      "update_queue_config",
      { queue_urn: queueUrn, config }
    );
  }
  async postMessage(queueUrn, message) {
    const result = await this.rpcClient.call(
      "post_message",
      { queue_urn: queueUrn, message }
    );
    return asNumber$1(result, "msg_index");
  }
  async subscribe(params) {
    const result = await this.rpcClient.call("subscribe", {
      queue_urn: params.queueUrn,
      // Wire fields are `userid` / `appid` to match Rust serde rename rules
      // (#[serde(rename = "userid", alias = "user_id")]).
      userid: params.userId,
      appid: params.appId,
      sub_id: params.subId ?? null,
      position: params.position
    });
    return asString$1(result, "subscription_id");
  }
  async unsubscribe(subId) {
    await this.rpcClient.call("unsubscribe", { sub_id: subId });
  }
  async fetchMessages(subId, length, autoCommit) {
    const result = await this.rpcClient.call("fetch_messages", { sub_id: subId, length, auto_commit: autoCommit });
    return asMessageList(result);
  }
  async readMessage(queueUrn, cursor, length) {
    const result = await this.rpcClient.call("read_message", { queue_urn: queueUrn, cursor, length });
    return asMessageList(result);
  }
  async commitAck(subId, index) {
    await this.rpcClient.call(
      "commit_ack",
      { sub_id: subId, index }
    );
  }
  async seek(subId, index) {
    await this.rpcClient.call(
      "seek",
      { sub_id: subId, index }
    );
  }
  async deleteMessageBefore(queueUrn, index) {
    const result = await this.rpcClient.call(
      "delete_message_before",
      { queue_urn: queueUrn, index }
    );
    return asNumber$1(result, "deleted_count");
  }
}
function compact$1(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== void 0) {
      out[k] = v;
    }
  }
  return out;
}
function asRecord$1(value, what) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an object`);
  }
  return value;
}
function asArrayOf(value, what) {
  if (!Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an array`);
  }
  return value;
}
class MsgCenterClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  // ---- msg.* ---------------------------------------------------------------
  async dispatch(msg, ingressCtx, idempotencyKey) {
    const params = compact$1({
      msg,
      ingress_ctx: ingressCtx,
      idempotency_key: idempotencyKey
    });
    const result = await this.rpcClient.call("msg.dispatch", params);
    return asRecord$1(result, "DispatchResult");
  }
  async postSend(msg, sendCtx, idempotencyKey) {
    const params = compact$1({
      msg,
      send_ctx: sendCtx,
      idempotency_key: idempotencyKey
    });
    const result = await this.rpcClient.call("msg.post_send", params);
    return asRecord$1(result, "PostSendResult");
  }
  async getNext(req) {
    const result = await this.rpcClient.call(
      "msg.get_next",
      compact$1({ ...req })
    );
    if (result == null) {
      return null;
    }
    return asRecord$1(result, "MsgRecordWithObject");
  }
  async peekBox(req) {
    const result = await this.rpcClient.call(
      "msg.peek_box",
      compact$1({ ...req })
    );
    return asArrayOf(result, "Vec<MsgRecordWithObject>");
  }
  async listBoxByTime(req) {
    const result = await this.rpcClient.call(
      "msg.list_box_by_time",
      compact$1({ ...req })
    );
    const record = asRecord$1(result, "MsgRecordPage");
    return {
      items: Array.isArray(record.items) ? record.items : [],
      next_cursor_sort_key: typeof record.next_cursor_sort_key === "number" ? record.next_cursor_sort_key : void 0,
      next_cursor_record_id: typeof record.next_cursor_record_id === "string" ? record.next_cursor_record_id : void 0
    };
  }
  async updateRecordState(recordId, newState, reason) {
    const result = await this.rpcClient.call(
      "msg.update_record_state",
      compact$1({ record_id: recordId, new_state: newState, reason })
    );
    return asRecord$1(result, "MsgRecord");
  }
  async updateRecordSession(recordId, sessionId) {
    const result = await this.rpcClient.call(
      "msg.update_record_session",
      { record_id: recordId, session_id: sessionId }
    );
    return asRecord$1(result, "MsgRecord");
  }
  async reportDelivery(recordId, result) {
    const response = await this.rpcClient.call(
      "msg.report_delivery",
      { record_id: recordId, result }
    );
    return asRecord$1(response, "MsgRecord");
  }
  async setReadState(req) {
    const result = await this.rpcClient.call(
      "msg.set_read_state",
      compact$1({ ...req })
    );
    return asRecord$1(result, "MsgReceiptObj");
  }
  async listReadReceipts(req) {
    const result = await this.rpcClient.call(
      "msg.list_read_receipts",
      compact$1({ ...req })
    );
    return asArrayOf(result, "Vec<MsgReceiptObj>");
  }
  async getRecord(recordId, withObject) {
    const result = await this.rpcClient.call(
      "msg.get_record",
      compact$1({ record_id: recordId, with_object: withObject })
    );
    if (result == null) {
      return null;
    }
    return asRecord$1(result, "MsgRecordWithObject");
  }
  async getMessage(msgId) {
    const result = await this.rpcClient.call(
      "msg.get_message",
      { msg_id: msgId }
    );
    if (result == null) {
      return null;
    }
    return asRecord$1(result, "MsgObject");
  }
  // ---- contact.* -----------------------------------------------------------
  async resolveDid(platform, accountId, profileHint, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.resolve_did",
      compact$1({
        platform,
        account_id: accountId,
        profile_hint: profileHint,
        contact_mgr_owner: contactMgrOwner
      })
    );
    if (typeof result !== "string") {
      throw new RPCError("contact.resolve_did expected to return a DID string");
    }
    return result;
  }
  async getPreferredBinding(did, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.get_preferred_binding",
      compact$1({ did, contact_mgr_owner: contactMgrOwner })
    );
    return asRecord$1(result, "AccountBinding");
  }
  async checkAccessPermission(did, contextId, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.check_access_permission",
      compact$1({ did, context_id: contextId, contact_mgr_owner: contactMgrOwner })
    );
    return asRecord$1(result, "AccessDecision");
  }
  async grantTemporaryAccess(dids, contextId, durationSecs, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.grant_temporary_access",
      compact$1({
        dids,
        context_id: contextId,
        duration_secs: durationSecs,
        contact_mgr_owner: contactMgrOwner
      })
    );
    const record = asRecord$1(result, "GrantTemporaryAccessResult");
    return {
      updated: Array.isArray(record.updated) ? record.updated : []
    };
  }
  async blockContact(did, reason, contactMgrOwner) {
    await this.rpcClient.call(
      "contact.block_contact",
      compact$1({ did, reason, contact_mgr_owner: contactMgrOwner })
    );
  }
  async importContacts(contacts, upgradeToFriend, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.import_contacts",
      compact$1({
        contacts,
        upgrade_to_friend: upgradeToFriend,
        contact_mgr_owner: contactMgrOwner
      })
    );
    return asRecord$1(result, "ImportReport");
  }
  async mergeContacts(targetDid, sourceDid, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.merge_contacts",
      compact$1({ target_did: targetDid, source_did: sourceDid, contact_mgr_owner: contactMgrOwner })
    );
    return asRecord$1(result, "Contact");
  }
  async updateContact(did, patch, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.update_contact",
      compact$1({ did, patch, contact_mgr_owner: contactMgrOwner })
    );
    return asRecord$1(result, "Contact");
  }
  async getContact(did, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.get_contact",
      compact$1({ did, contact_mgr_owner: contactMgrOwner })
    );
    if (result == null) {
      return null;
    }
    return asRecord$1(result, "Contact");
  }
  async listContacts(query, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.list_contacts",
      compact$1({ query, contact_mgr_owner: contactMgrOwner })
    );
    return asArrayOf(result, "Vec<Contact>");
  }
  async getGroupSubscribers(groupId, limit, offset, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.get_group_subscribers",
      compact$1({ group_id: groupId, limit, offset, contact_mgr_owner: contactMgrOwner })
    );
    if (!Array.isArray(result)) {
      throw new RPCError("expected Vec<DID> response");
    }
    return result;
  }
  async setGroupSubscribers(groupId, subscribers, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.set_group_subscribers",
      compact$1({ group_id: groupId, subscribers, contact_mgr_owner: contactMgrOwner })
    );
    const record = asRecord$1(result, "SetGroupSubscribersResult");
    if (typeof record.group_id !== "string" || typeof record.subscriber_count !== "number") {
      throw new RPCError("Invalid SetGroupSubscribersResult");
    }
    return {
      group_id: record.group_id,
      subscriber_count: record.subscriber_count
    };
  }
}
function compact(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== void 0) {
      out[k] = v;
    }
  }
  return out;
}
function asString(value, what) {
  if (typeof value !== "string") {
    throw new RPCError(`expected ${what} to be a string`);
  }
  return value;
}
function asBoolean(value, what) {
  if (typeof value !== "boolean") {
    throw new RPCError(`expected ${what} to be a boolean`);
  }
  return value;
}
function asNumber(value, what) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RPCError(`expected ${what} to be a number`);
  }
  return value;
}
function asArray(value, what) {
  if (!Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an array`);
  }
  return value;
}
function asRecord(value, what) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an object`);
  }
  return value;
}
class RepoClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async store(contentId) {
    const result = await this.rpcClient.call("store", {
      content_id: contentId
    });
    return asString(result, "ObjId");
  }
  async collect(contentMeta, referralProof) {
    const result = await this.rpcClient.call(
      "collect",
      compact({ content_meta: contentMeta, referral_proof: referralProof })
    );
    return asString(result, "content_id");
  }
  async pin(contentId, downloadProof) {
    const result = await this.rpcClient.call("pin", { content_id: contentId, download_proof: downloadProof });
    return asBoolean(result, "pin response");
  }
  async unpin(contentId, force = false) {
    const result = await this.rpcClient.call(
      "unpin",
      { content_id: contentId, force }
    );
    return asBoolean(result, "unpin response");
  }
  async uncollect(contentId, force = false) {
    const result = await this.rpcClient.call(
      "uncollect",
      { content_id: contentId, force }
    );
    return asBoolean(result, "uncollect response");
  }
  async addProof(proof) {
    const result = await this.rpcClient.call("add_proof", { proof });
    return asString(result, "proof_id");
  }
  async getProofs(contentId, filter) {
    const result = await this.rpcClient.call(
      "get_proofs",
      compact({ content_id: contentId, filter })
    );
    const arr = asArray(result, "Vec<RepoProof>");
    return arr.map((entry, idx) => {
      const record = asRecord(entry, `RepoProof[${idx}]`);
      if (record.kind !== "Action" && record.kind !== "Collection") {
        throw new RPCError(`RepoProof[${idx}] has unknown kind: ${String(record.kind)}`);
      }
      return record;
    });
  }
  async resolve(contentName) {
    const result = await this.rpcClient.call("resolve", {
      content_name: contentName
    });
    const arr = asArray(result, "Vec<ObjId>");
    return arr.map((entry, idx) => asString(entry, `ObjId[${idx}]`));
  }
  async list(filter) {
    const result = await this.rpcClient.call(
      "list",
      compact({ filter })
    );
    const arr = asArray(result, "Vec<RepoRecord>");
    return arr.map((entry, idx) => {
      const record = asRecord(entry, `RepoRecord[${idx}]`);
      return {
        content_id: asString(record.content_id, `RepoRecord[${idx}].content_id`),
        content_name: typeof record.content_name === "string" ? record.content_name : void 0,
        status: asString(record.status, `RepoRecord[${idx}].status`),
        origin: asString(record.origin, `RepoRecord[${idx}].origin`),
        meta: record.meta,
        owner_did: typeof record.owner_did === "string" ? record.owner_did : void 0,
        author: typeof record.author === "string" ? record.author : void 0,
        access_policy: asString(record.access_policy, `RepoRecord[${idx}].access_policy`),
        price: typeof record.price === "string" ? record.price : void 0,
        content_size: typeof record.content_size === "number" ? record.content_size : void 0,
        collected_at: typeof record.collected_at === "number" ? record.collected_at : void 0,
        pinned_at: typeof record.pinned_at === "number" ? record.pinned_at : void 0,
        updated_at: typeof record.updated_at === "number" ? record.updated_at : void 0
      };
    });
  }
  async stat() {
    const result = await this.rpcClient.call("stat", {});
    const record = asRecord(result, "RepoStat");
    return {
      total_objects: asNumber(record.total_objects, "RepoStat.total_objects"),
      collected_objects: asNumber(record.collected_objects, "RepoStat.collected_objects"),
      pinned_objects: asNumber(record.pinned_objects, "RepoStat.pinned_objects"),
      local_objects: asNumber(record.local_objects, "RepoStat.local_objects"),
      remote_objects: asNumber(record.remote_objects, "RepoStat.remote_objects"),
      total_content_bytes: asNumber(record.total_content_bytes, "RepoStat.total_content_bytes"),
      total_proofs: asNumber(record.total_proofs, "RepoStat.total_proofs")
    };
  }
  async serve(contentId, requestContext) {
    const result = await this.rpcClient.call("serve", { content_id: contentId, request_context: requestContext });
    const record = asRecord(result, "RepoServeResult");
    return {
      status: asString(record.status, "RepoServeResult.status"),
      content_ref: record.content_ref && typeof record.content_ref === "object" ? record.content_ref : void 0,
      download_proof: record.download_proof && typeof record.download_proof === "object" ? record.download_proof : void 0,
      reject_code: typeof record.reject_code === "string" ? record.reject_code : void 0,
      reject_reason: typeof record.reject_reason === "string" ? record.reject_reason : void 0
    };
  }
  async announce(contentId) {
    const result = await this.rpcClient.call("announce", {
      content_id: contentId
    });
    return asBoolean(result, "announce response");
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isVerificationMethodArray(value) {
  return Array.isArray(value);
}
function isServiceArray(value) {
  return value === void 0 || Array.isArray(value);
}
function isDIDContext(value) {
  if (typeof value === "string") {
    return true;
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isW3CDIDDocumentBase(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isDIDContext(value["@context"]) && typeof value.id === "string" && isVerificationMethodArray(value.verificationMethod) && Array.isArray(value.authentication) && typeof value.exp === "number" && typeof value.iat === "number" && isServiceArray(value.service);
}
function isBuckyOSOwnerConfigDocument(value) {
  return isW3CDIDDocumentBase(value) && typeof value.name === "string" && typeof value.full_name === "string";
}
function isUserDocument(value) {
  return isBuckyOSOwnerConfigDocument(value);
}
function isBuckyOSDeviceMiniDocument(value) {
  return isRecord(value) && typeof value.n === "string" && typeof value.x === "string" && typeof value.exp === "number";
}
function isBuckyOSZoneBootConfig(value) {
  return isRecord(value) && Array.isArray(value.oods) && value.oods.every((item) => typeof item === "string") && typeof value.exp === "number";
}
function isBuckyOSNodeIdentityConfig(value) {
  return isRecord(value) && typeof value.zone_did === "string" && isRecord(value.owner_public_key) && typeof value.owner_did === "string" && typeof value.device_doc_jwt === "string" && typeof value.device_mini_doc_jwt === "string" && typeof value.zone_iat === "number";
}
function isBuckyOSDeviceDocument(value) {
  return isW3CDIDDocumentBase(value) && typeof value.owner === "string" && typeof value.device_type === "string" && typeof value.name === "string";
}
function isBuckyOSAgentDocument(value) {
  return isW3CDIDDocumentBase(value) && typeof value.owner === "string" && isRecord(value.httpServicePorts);
}
function isBuckyOSZoneDocument(value) {
  return isW3CDIDDocumentBase(value) && typeof value.hostname === "string" && typeof value.owner === "string" && Array.isArray(value.oods) && typeof value.boot_jwt === "string";
}
function isDIDDocumentBase(value) {
  return isW3CDIDDocumentBase(value);
}
function isOwnerConfigDocument(value) {
  return isBuckyOSOwnerConfigDocument(value);
}
function isDeviceMiniConfig(value) {
  return isBuckyOSDeviceMiniDocument(value);
}
function isDeviceDocument(value) {
  return isBuckyOSDeviceDocument(value);
}
function isAgentDocument(value) {
  return isBuckyOSAgentDocument(value);
}
function isZoneDocument(value) {
  return isBuckyOSZoneDocument(value);
}
function parseW3CDIDDocumentBase(value) {
  return isW3CDIDDocumentBase(value) ? value : null;
}
function parseBuckyOSOwnerConfigDocument(value) {
  return isBuckyOSOwnerConfigDocument(value) ? value : null;
}
function parseOwnerConfigDocument(value) {
  return parseBuckyOSOwnerConfigDocument(value);
}
function parseBuckyOSDeviceMiniDocument(value) {
  return isBuckyOSDeviceMiniDocument(value) ? value : null;
}
function parseDeviceMiniConfig(value) {
  return parseBuckyOSDeviceMiniDocument(value);
}
function parseBuckyOSDIDDocument(value) {
  if (isBuckyOSOwnerConfigDocument(value)) {
    return value;
  }
  if (isBuckyOSAgentDocument(value)) {
    return value;
  }
  if (isBuckyOSDeviceDocument(value)) {
    return value;
  }
  if (isBuckyOSZoneDocument(value)) {
    return value;
  }
  return null;
}
function getDidMethod(did) {
  if (typeof did !== "string" || !did.startsWith("did:")) {
    return null;
  }
  const parts = did.split(":");
  return parts.length >= 3 ? parts[1] : null;
}
function getDidIdentifier(did) {
  if (typeof did !== "string" || !did.startsWith("did:")) {
    return null;
  }
  const parts = did.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : null;
}
const DEFAULT_NODE_GATEWAY_PORT = 3180;
const DEFAULT_SESSION_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_RENEW_INTERVAL_MS = 5e3;
const BUCKYOS_HOST_GATEWAY_ENV = "BUCKYOS_HOST_GATEWAY";
const BUCKYOS_APPCLIENT_SESSION_TOKEN_ENV = "BUCKYOS_APPCLIENT_SESSION_TOKEN";
const DEFAULT_DOCKER_HOST_GATEWAY = "host.docker.internal";
var RuntimeType = /* @__PURE__ */ ((RuntimeType2) => {
  RuntimeType2["Browser"] = "Browser";
  RuntimeType2["NodeJS"] = "NodeJS";
  RuntimeType2["AppRuntime"] = "AppRuntime";
  RuntimeType2["AppClient"] = "AppClient";
  RuntimeType2["AppService"] = "AppService";
  RuntimeType2["Unknown"] = "Unknown";
  return RuntimeType2;
})(RuntimeType || {});
const DEFAULT_CONFIG = {
  zoneHost: "",
  appId: "",
  defaultProtocol: "http://",
  runtimeType: "Unknown",
  userid: null,
  ownerUserId: null,
  rootDir: "",
  sessionToken: null,
  refreshToken: null,
  privateKeySearchPaths: [],
  systemConfigServiceUrl: "",
  verifyHubServiceUrl: "",
  nodeGatewayPort: DEFAULT_NODE_GATEWAY_PORT,
  autoRenew: true,
  renewIntervalMs: DEFAULT_RENEW_INTERVAL_MS
};
function getProcessEnv() {
  const runtimeProcess = globalThis.process;
  return (runtimeProcess == null ? void 0 : runtimeProcess.env) ?? {};
}
function hasNodeRuntime$1() {
  var _a;
  const runtimeProcess = globalThis.process;
  return Boolean((_a = runtimeProcess == null ? void 0 : runtimeProcess.versions) == null ? void 0 : _a.node);
}
function hasBrowserStorage() {
  return typeof localStorage !== "undefined";
}
function hasFetchRuntime() {
  return typeof fetch === "function";
}
function ensureBuffer() {
  const bufferCtor = globalThis.Buffer;
  if (!bufferCtor || typeof bufferCtor !== "function") {
    throw new Error("Buffer is not available in this runtime");
  }
  return bufferCtor;
}
function base64UrlEncode(value) {
  const BufferCtor = ensureBuffer();
  const base64 = typeof value === "string" ? BufferCtor.from(value, "utf8").toString("base64") : BufferCtor.from(value).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  if (typeof atob === "function") {
    return atob(padded);
  }
  const BufferCtor = ensureBuffer();
  return BufferCtor.from(padded, "base64").toString("utf8");
}
function parseSessionTokenClaims(token) {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}
function trimToNull$1(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function normalizeServicePath(serviceName) {
  if (serviceName === "system-config") {
    return "system_config";
  }
  return serviceName;
}
function getFullAppId(appId, ownerUserId) {
  return `${ownerUserId}-${appId}`;
}
function getSessionTokenEnvKey(appFullId, isAppService) {
  const normalized = appFullId.toUpperCase().replace(/-/g, "_");
  return isAppService ? `${normalized}_TOKEN` : `${normalized}_SESSION_TOKEN`;
}
function resolveZoneHostFromDid(zoneDid) {
  const normalized = trimToNull$1(zoneDid);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("did:web:")) {
    return normalized.slice("did:web:".length).replace(/:/g, ".");
  }
  if (normalized.startsWith("did:bns:")) {
    return normalized.slice("did:bns:".length);
  }
  return null;
}
function parseAppIdentityFromInstanceConfig(appInstanceConfig) {
  var _a, _b, _c;
  try {
    const parsed = JSON.parse(appInstanceConfig);
    const appId = typeof ((_b = (_a = parsed.app_spec) == null ? void 0 : _a.app_doc) == null ? void 0 : _b.name) === "string" ? parsed.app_spec.app_doc.name.trim() : "";
    const ownerUserId = typeof ((_c = parsed.app_spec) == null ? void 0 : _c.user_id) === "string" ? parsed.app_spec.user_id.trim() : "";
    if (!appId || !ownerUserId) {
      return null;
    }
    return { appId, ownerUserId };
  } catch {
    return null;
  }
}
async function importNodeModule$1(moduleName) {
  if (hasNodeRuntime$1() && typeof require === "function") {
    return require(moduleName);
  }
  const dynamicImport = Function("name", "return import(name)");
  return dynamicImport(moduleName);
}
class BaseRuntimeProfile {
  async initialize(runtime) {
    runtime.resolveNodeIdentityFromEnv();
    await runtime.resolveZoneHostFromLocalConfig();
  }
  async login(runtime) {
    await runtime.initialize();
    runtime.startAutoRenewIfNeeded();
  }
  supportsManagedSessionRenewal() {
    return false;
  }
  shouldSkipVerifyHubRenewal(_runtime) {
    return false;
  }
  async getVerifyHubLoginJwt(_runtime, sessionToken) {
    return sessionToken;
  }
}
class BrowserRuntimeProfile extends BaseRuntimeProfile {
  getRelativeZoneServiceURL(servicePath) {
    return `/kapi/${servicePath}/`;
  }
  getRelativeSystemConfigServiceURL() {
    return "/kapi/system_config";
  }
  getServiceSettingsPath(runtime) {
    return `services/${runtime.getAppId()}/settings`;
  }
  getZoneServiceURL(_runtime, servicePath) {
    return this.getRelativeZoneServiceURL(servicePath);
  }
  getSystemConfigServiceURL(_runtime) {
    return this.getRelativeSystemConfigServiceURL();
  }
  getMySettingsPath(runtime) {
    return this.getServiceSettingsPath(runtime);
  }
}
class AppRuntimeProfile extends BrowserRuntimeProfile {
}
class ManagedSessionRuntimeProfile extends BaseRuntimeProfile {
  async login(runtime) {
    await runtime.initialize();
    await runtime.renewTokenFromVerifyHub();
    runtime.startAutoRenewIfNeeded();
  }
  supportsManagedSessionRenewal() {
    return true;
  }
}
class AppClientRuntimeProfile extends ManagedSessionRuntimeProfile {
  async initialize(runtime) {
    await super.initialize(runtime);
    await runtime.ensureAppClientSessionToken();
  }
  getZoneGatewayServiceURL(runtime, servicePath) {
    const zoneHost = trimToNull$1(runtime.getZoneHostName());
    if (!zoneHost) {
      throw new Error("zoneHost is required in AppClient mode");
    }
    return `${runtime.getDefaultProtocol()}${zoneHost}/kapi/${servicePath}`;
  }
  getZoneSystemConfigURL(runtime) {
    const zoneHost = trimToNull$1(runtime.getZoneHostName());
    if (!zoneHost) {
      throw new Error("zoneHost is required in AppClient mode");
    }
    return `${runtime.getDefaultProtocol()}${zoneHost}/kapi/system_config`;
  }
  getZoneServiceURL(runtime, servicePath) {
    return this.getZoneGatewayServiceURL(runtime, servicePath);
  }
  getSystemConfigServiceURL(runtime) {
    return this.getZoneSystemConfigURL(runtime);
  }
  getMySettingsPath() {
    throw new Error("AppClient not support getMySettingsPath");
  }
  shouldSkipVerifyHubRenewal(runtime) {
    return !trimToNull$1(runtime.getZoneHostName()) && !runtime.getConfiguredVerifyHubServiceUrl();
  }
  async getVerifyHubLoginJwt(runtime, _sessionToken) {
    return runtime.createAppClientSessionToken();
  }
}
class AppServiceRuntimeProfile extends ManagedSessionRuntimeProfile {
  async initialize(runtime) {
    await super.initialize(runtime);
    runtime.ensureAppServiceSessionToken();
  }
  getNodeGatewayServiceURL(runtime, servicePath) {
    const port = runtime.getNodeGatewayPort();
    return `http://${runtime.resolveAppServiceGatewayHost()}:${port}/kapi/${servicePath}`;
  }
  getNodeGatewaySystemConfigURL(runtime) {
    const port = runtime.getNodeGatewayPort();
    return `http://${runtime.resolveAppServiceGatewayHost()}:${port}/kapi/system_config`;
  }
  getUserAppSettingsPath(runtime) {
    const ownerUserId = runtime.getOwnerUserId();
    if (!ownerUserId) {
      throw new Error("ownerUserId is required for AppService settings");
    }
    return `users/${ownerUserId}/apps/${runtime.getAppId()}/settings`;
  }
  getZoneServiceURL(runtime, servicePath) {
    return this.getNodeGatewayServiceURL(runtime, servicePath);
  }
  getSystemConfigServiceURL(runtime) {
    return this.getNodeGatewaySystemConfigURL(runtime);
  }
  getMySettingsPath(runtime) {
    return this.getUserAppSettingsPath(runtime);
  }
}
function createRuntimeProfile(runtimeType) {
  switch (runtimeType) {
    case "AppClient":
      return new AppClientRuntimeProfile();
    case "AppService":
      return new AppServiceRuntimeProfile();
    case "AppRuntime":
      return new AppRuntimeProfile();
    case "Browser":
    case "NodeJS":
    case "Unknown":
    default:
      return new BrowserRuntimeProfile();
  }
}
class BuckyOSRuntime {
  constructor(config) {
    const normalizedOwnerUserId = trimToNull$1(config.ownerUserId) ?? trimToNull$1(config.userid);
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      appId: config.appId,
      userid: normalizedOwnerUserId,
      ownerUserId: normalizedOwnerUserId,
      zoneHost: config.zoneHost ?? "",
      defaultProtocol: config.defaultProtocol ?? DEFAULT_CONFIG.defaultProtocol
    };
    this.sessionToken = trimToNull$1(config.sessionToken);
    this.refreshToken = trimToNull$1(config.refreshToken);
    this.renewTimer = null;
    this.initialized = false;
    this.profile = createRuntimeProfile(this.config.runtimeType);
  }
  async initialize() {
    if (this.initialized) {
      return;
    }
    await this.profile.initialize(this);
    this.validateSessionToken();
    this.initialized = true;
  }
  async login() {
    await this.profile.login(this);
  }
  setConfig(config) {
    const normalizedOwnerUserId = trimToNull$1(config.ownerUserId) ?? trimToNull$1(config.userid);
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      appId: config.appId,
      userid: normalizedOwnerUserId,
      ownerUserId: normalizedOwnerUserId
    };
    this.profile = createRuntimeProfile(this.config.runtimeType);
  }
  getConfig() {
    return { ...this.config };
  }
  getAppId() {
    return this.config.appId;
  }
  getOwnerUserId() {
    return trimToNull$1(this.config.ownerUserId);
  }
  getFullAppId() {
    const ownerUserId = this.getOwnerUserId();
    if (!ownerUserId) {
      return this.config.appId;
    }
    return getFullAppId(this.config.appId, ownerUserId);
  }
  getZoneHostName() {
    return this.config.zoneHost;
  }
  getDefaultProtocol() {
    return this.config.defaultProtocol;
  }
  getNodeGatewayPort() {
    return this.config.nodeGatewayPort ?? DEFAULT_NODE_GATEWAY_PORT;
  }
  getConfiguredVerifyHubServiceUrl() {
    return trimToNull$1(this.config.verifyHubServiceUrl);
  }
  getZoneServiceURL(serviceName) {
    const servicePath = normalizeServicePath(serviceName);
    return this.profile.getZoneServiceURL(this, servicePath);
  }
  getSystemConfigServiceURL() {
    const configuredUrl = this.getConfiguredSystemConfigServiceUrl();
    if (configuredUrl) {
      return configuredUrl;
    }
    return this.profile.getSystemConfigServiceURL(this);
  }
  setSessionToken(token) {
    this.sessionToken = trimToNull$1(token);
  }
  setRefreshToken(token) {
    this.refreshToken = trimToNull$1(token);
  }
  getSessionToken() {
    return this.sessionToken;
  }
  getRefreshToken() {
    return this.refreshToken;
  }
  clearAuthState() {
    this.sessionToken = null;
    this.refreshToken = null;
    this.stopAutoRenew();
  }
  stopAutoRenew() {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }
  getServiceRpcClient(serviceName) {
    return new kRPCClient(this.getZoneServiceURL(serviceName), this.sessionToken, null, {
      sessionTokenProvider: this.ensureSessionTokenReady.bind(this),
      onSessionTokenChanged: this.setSessionToken.bind(this)
    });
  }
  getSystemConfigClient() {
    return new SystemConfigClient(this.getSystemConfigServiceURL(), this.sessionToken, {
      sessionTokenProvider: this.ensureSessionTokenReady.bind(this),
      onSessionTokenChanged: this.setSessionToken.bind(this)
    });
  }
  getVerifyHubClient() {
    const configuredUrl = this.getConfiguredVerifyHubServiceUrl();
    const rpcClient = new kRPCClient(configuredUrl ?? this.getZoneServiceURL("verify-hub"), this.sessionToken);
    return new VerifyHubClient(rpcClient);
  }
  getTaskManagerClient() {
    const rpcClient = this.getServiceRpcClient("task-manager");
    return new TaskManagerClient(rpcClient);
  }
  getWorkflowClient() {
    const rpcClient = this.getServiceRpcClient("workflow");
    return new WorkflowClient(rpcClient);
  }
  getAiccClient() {
    return new AiccClient(this.getServiceRpcClient("aicc"));
  }
  getMsgQueueClient() {
    return new MsgQueueClient(this.getServiceRpcClient("kmsg"));
  }
  getMsgCenterClient() {
    return new MsgCenterClient(this.getServiceRpcClient("msg-center"));
  }
  getRepoClient() {
    return new RepoClient(this.getServiceRpcClient("repo-service"));
  }
  async getMySettings() {
    const settingsPath = this.getMySettingsPath();
    const settingsValue = await this.getSystemConfigClient().get(settingsPath);
    return JSON.parse(settingsValue.value);
  }
  async updateMySettings(jsonPath, settings) {
    const settingsPath = this.getMySettingsPath();
    const settingsValue = JSON.stringify(settings);
    await this.getSystemConfigClient().setByJsonPath(settingsPath, jsonPath, settingsValue);
  }
  async updateAllMySettings(settings) {
    const settingsPath = this.getMySettingsPath();
    const settingsValue = JSON.stringify(settings);
    await this.getSystemConfigClient().set(settingsPath, settingsValue);
  }
  async renewTokenFromVerifyHub() {
    if (!this.profile.supportsManagedSessionRenewal()) {
      return;
    }
    const sessionToken = this.sessionToken;
    if (!sessionToken) {
      return;
    }
    const claims = parseSessionTokenClaims(sessionToken);
    if (!claims || !this.needsRenew(claims)) {
      return;
    }
    if (this.profile.shouldSkipVerifyHubRenewal(this)) {
      return;
    }
    const verifyHubClient = this.getVerifyHubClient();
    const tokenPair = claims.iss === "verify-hub" ? this.refreshToken ? await verifyHubClient.refreshToken({ refresh_token: this.refreshToken }) : await verifyHubClient.loginByJwt({
      jwt: await this.profile.getVerifyHubLoginJwt(this, sessionToken)
    }) : await verifyHubClient.loginByJwt({ jwt: sessionToken });
    this.sessionToken = trimToNull$1(tokenPair.session_token);
    this.refreshToken = trimToNull$1(tokenPair.refresh_token);
    this.validateSessionToken();
  }
  async ensureSessionTokenReady() {
    if (this.config.runtimeType === "Browser") {
      return this.ensureBrowserSessionToken();
    }
    if (this.profile.supportsManagedSessionRenewal()) {
      await this.renewTokenFromVerifyHub();
    }
    return this.sessionToken;
  }
  ensureAppServiceSessionToken() {
    if (!this.sessionToken) {
      this.sessionToken = this.loadAppServiceSessionTokenFromEnv();
    }
  }
  async ensureAppClientSessionToken() {
    if (!this.sessionToken) {
      this.sessionToken = this.loadAppClientSessionTokenFromEnv();
    }
    if (!this.sessionToken) {
      this.sessionToken = await this.createAppClientSessionToken();
    }
  }
  resolveNodeIdentityFromEnv() {
    if (!hasNodeRuntime$1()) {
      return;
    }
    if (this.config.runtimeType !== "AppService") {
      return;
    }
    const env = getProcessEnv();
    const appInstanceConfig = trimToNull$1(env.app_instance_config);
    if (!appInstanceConfig) {
      return;
    }
    const identity = parseAppIdentityFromInstanceConfig(appInstanceConfig);
    if (!identity) {
      return;
    }
    if (!this.config.appId) {
      this.config.appId = identity.appId;
    }
    if (!trimToNull$1(this.config.ownerUserId)) {
      this.config.ownerUserId = identity.ownerUserId;
    }
  }
  async resolveZoneHostFromLocalConfig() {
    if (!hasNodeRuntime$1()) {
      return;
    }
    if (trimToNull$1(this.config.zoneHost)) {
      return;
    }
    const roots = await this.getPrivateKeySearchRoots();
    const zoneHost = await this.tryResolveZoneHostFromSearchRoots(roots);
    if (zoneHost) {
      this.config.zoneHost = zoneHost;
    }
  }
  validateSessionToken() {
    if (!this.sessionToken) {
      return;
    }
    const claims = parseSessionTokenClaims(this.sessionToken);
    const tokenAppId = typeof (claims == null ? void 0 : claims.appid) === "string" ? claims.appid : typeof (claims == null ? void 0 : claims.aud) === "string" ? claims.aud : null;
    if (tokenAppId && tokenAppId !== this.config.appId) {
      throw new Error(`session token appid mismatch: ${tokenAppId} != ${this.config.appId}`);
    }
  }
  async ensureBrowserSessionToken() {
    const claims = parseSessionTokenClaims(this.sessionToken);
    if (this.sessionToken && claims && !this.needsRenew(claims)) {
      return this.sessionToken;
    }
    return this.refreshBrowserSessionToken();
  }
  normalizeBrowserUserInfo(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const parsed = raw;
    const userId = typeof parsed.user_id === "string" ? parsed.user_id.trim() : "";
    const userType = typeof parsed.user_type === "string" ? parsed.user_type.trim() : "";
    const userName = typeof parsed.user_name === "string" ? parsed.user_name.trim() : typeof parsed.show_name === "string" ? parsed.show_name.trim() : "";
    if (!userId || !userType) {
      return null;
    }
    return {
      user_name: userName || userId,
      user_id: userId,
      user_type: userType
    };
  }
  async refreshBrowserSession() {
    const sessionToken = await this.refreshBrowserSessionToken();
    if (!sessionToken) {
      return null;
    }
    return hasBrowserStorage() ? getBrowserUserInfo() : null;
  }
  async logoutBrowserSSO() {
    if (this.config.runtimeType !== "Browser" && this.config.runtimeType !== "AppRuntime") {
      return;
    }
    if (!hasFetchRuntime()) {
      return;
    }
    try {
      const response = await fetch("/sso_logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        keepalive: true
      });
      if (!response.ok) {
        console.warn("BuckyOS browser sso_logout failed:", response.status);
      }
    } catch (error) {
      console.warn("BuckyOS browser sso_logout failed:", error);
    }
  }
  async refreshBrowserSessionToken() {
    if (!hasFetchRuntime()) {
      return this.sessionToken;
    }
    const cachedUserInfo = hasBrowserStorage() ? getBrowserUserInfo() : null;
    try {
      const response = await fetch("/sso_refresh", {
        method: "POST",
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) {
        this.sessionToken = null;
        return null;
      }
      const payload = await response.json();
      const sessionToken = trimToNull$1(
        typeof payload.access_token === "string" ? payload.access_token : typeof payload.session_token === "string" ? payload.session_token : null
      );
      const userInfo = this.normalizeBrowserUserInfo(payload.user_info) ?? cachedUserInfo;
      if (!sessionToken || !userInfo) {
        this.sessionToken = null;
        return null;
      }
      this.sessionToken = sessionToken;
      this.refreshToken = null;
      saveBrowserUserInfo(userInfo);
      this.validateSessionToken();
      return this.sessionToken;
    } catch (error) {
      console.warn("BuckyOS browser sso_refresh failed:", error);
      this.sessionToken = null;
      return null;
    }
  }
  needsRenew(claims) {
    if (claims.iss && claims.iss !== "verify-hub") {
      return true;
    }
    if (typeof claims.exp !== "number") {
      return false;
    }
    const now = Math.floor(Date.now() / 1e3);
    return now >= claims.exp - 30;
  }
  startAutoRenewIfNeeded() {
    if (!this.profile.supportsManagedSessionRenewal() || this.config.autoRenew === false) {
      return;
    }
    if (this.renewTimer) {
      return;
    }
    const interval = this.config.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS;
    const tick = async () => {
      try {
        await this.renewTokenFromVerifyHub();
      } catch (error) {
        console.warn("BuckyOS token renew failed:", error);
      }
    };
    void tick();
    this.renewTimer = setInterval(() => {
      void tick();
    }, interval);
  }
  loadAppServiceSessionTokenFromEnv() {
    const env = getProcessEnv();
    const ownerUserId = this.getOwnerUserId();
    const sessionTokenKeys = [];
    if (ownerUserId) {
      sessionTokenKeys.push(getSessionTokenEnvKey(getFullAppId(this.config.appId, ownerUserId), true));
    }
    sessionTokenKeys.push(getSessionTokenEnvKey(this.config.appId, true));
    const uniqueKeys = Array.from(new Set(sessionTokenKeys));
    for (const key of uniqueKeys) {
      const token = trimToNull$1(env[key]);
      if (token) {
        return token;
      }
    }
    throw new Error(`failed to load app-service session token, tried keys: ${uniqueKeys.join(", ")}`);
  }
  loadAppClientSessionTokenFromEnv() {
    return trimToNull$1(getProcessEnv()[BUCKYOS_APPCLIENT_SESSION_TOKEN_ENV]);
  }
  async createAppClientSessionToken() {
    if (!hasNodeRuntime$1()) {
      throw new Error("AppClient mode requires Node.js");
    }
    const material = await this.loadLocalSigningMaterial();
    const now = Math.floor(Date.now() / 1e3);
    const claims = {
      token_type: "Normal",
      appid: this.config.appId,
      jti: String(now),
      session: now,
      sub: material.subject,
      userid: material.subject,
      iss: material.issuer,
      exp: now + DEFAULT_SESSION_TOKEN_TTL_SECONDS,
      extra: {}
    };
    return this.signJwtWithEd25519({
      alg: "EdDSA",
      kid: material.issuer
    }, claims, material.keyPem);
  }
  async loadLocalSigningMaterial() {
    await importNodeModule$1("node:fs/promises");
    const path = await importNodeModule$1("node:path");
    const configuredUserId = this.getOwnerUserId();
    if (!configuredUserId) {
      const etcDir = await this.getBuckyOSEtcDir();
      const deviceName = await this.readDeviceNameFromNodeIdentityPath(path.join(etcDir, "node_identity.json"));
      if (!deviceName) {
        throw new Error(`failed to resolve userid from ${path.join(etcDir, "node_identity.json")} device_mini_doc_jwt`);
      }
      const keyPem = await this.readPemFile(path.join(etcDir, "node_private_key.pem"));
      if (!keyPem) {
        throw new Error(`failed to load node_private_key.pem from ${etcDir}`);
      }
      this.config.userid = deviceName;
      this.config.ownerUserId = deviceName;
      return {
        keyPem,
        issuer: deviceName,
        subject: deviceName,
        sourcePath: path.join(etcDir, "node_private_key.pem")
      };
    }
    const roots = await this.getPrivateKeySearchRoots();
    const deviceMaterial = await this.tryLoadDeviceSigningMaterial(configuredUserId, roots);
    if (deviceMaterial) {
      return deviceMaterial;
    }
    const userMaterial = await this.tryLoadUserSigningMaterial(configuredUserId, roots);
    if (userMaterial) {
      return userMaterial;
    }
    throw new Error(`failed to find AppClient private key for userid=${configuredUserId} in search roots: ${roots.join(", ")}`);
  }
  async getPrivateKeySearchRoots() {
    var _a;
    const env = getProcessEnv();
    const path = await importNodeModule$1("node:path");
    const os = await importNodeModule$1("node:os");
    const roots = [];
    for (const item of this.config.privateKeySearchPaths ?? []) {
      const trimmed = trimToNull$1(item);
      if (trimmed) {
        roots.push(trimmed);
      }
    }
    const explicitClientDir = trimToNull$1(env.BUCKYOS_APP_CLIENT_DIR);
    if (explicitClientDir) {
      roots.push(explicitClientDir);
    }
    const homeDir = trimToNull$1(env.HOME) ?? trimToNull$1(env.USERPROFILE) ?? trimToNull$1((_a = os.homedir) == null ? void 0 : _a.call(os));
    if (homeDir) {
      roots.push(path.join(homeDir, ".buckyos"));
      roots.push(path.join(homeDir, ".buckycli"));
    }
    const rootDir = trimToNull$1(this.config.rootDir) ?? trimToNull$1(env.BUCKYOS_ROOT) ?? "/opt/buckyos";
    roots.push(rootDir);
    roots.push(path.join(rootDir, "etc"));
    return Array.from(new Set(roots));
  }
  async getBuckyOSRootDir() {
    const env = getProcessEnv();
    return trimToNull$1(this.config.rootDir) ?? trimToNull$1(env.BUCKYOS_ROOT) ?? "/opt/buckyos";
  }
  async getBuckyOSEtcDir() {
    const path = await importNodeModule$1("node:path");
    return path.join(await this.getBuckyOSRootDir(), "etc");
  }
  async readPemFile(filePath) {
    const fs = await importNodeModule$1("node:fs/promises");
    try {
      const keyPem = (await fs.readFile(filePath, "utf8")).trim();
      return keyPem || null;
    } catch {
      return null;
    }
  }
  async readNodeIdentityMetadata(nodeIdentityPath) {
    const fs = await importNodeModule$1("node:fs/promises");
    try {
      const raw = await fs.readFile(nodeIdentityPath, "utf8");
      const parsed = JSON.parse(raw);
      const deviceName = this.extractDeviceNameFromIdentityPayload(parsed);
      return {
        deviceName,
        zoneDid: typeof parsed.zone_did === "string" ? parsed.zone_did.trim() || null : null,
        zoneName: typeof parsed.zone_name === "string" ? parsed.zone_name.trim() || null : null
      };
    } catch {
      return null;
    }
  }
  extractDeviceNameFromIdentityPayload(payload) {
    const miniDocJwt = typeof payload.device_mini_doc_jwt === "string" ? payload.device_mini_doc_jwt : null;
    const miniDocClaims = parseSessionTokenClaims(miniDocJwt);
    const miniDocName = typeof (miniDocClaims == null ? void 0 : miniDocClaims.n) === "string" ? miniDocClaims.n.trim() : "";
    if (miniDocName) {
      return miniDocName;
    }
    const deviceDocJwt = typeof payload.device_doc_jwt === "string" ? payload.device_doc_jwt : null;
    const deviceDocClaims = parseSessionTokenClaims(deviceDocJwt);
    for (const claimKey of ["name", "sub"]) {
      const claimValue = deviceDocClaims == null ? void 0 : deviceDocClaims[claimKey];
      const candidate = typeof claimValue === "string" ? claimValue.trim() : "";
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }
  async readDeviceNameFromNodeIdentityPath(nodeIdentityPath) {
    const metadata = await this.readNodeIdentityMetadata(nodeIdentityPath);
    return (metadata == null ? void 0 : metadata.deviceName) ?? null;
  }
  async tryLoadDeviceSigningMaterial(userId, roots) {
    const path = await importNodeModule$1("node:path");
    const candidateDirs = [
      await this.getBuckyOSEtcDir(),
      ...roots.filter((root) => !root.endsWith(".pem"))
    ];
    for (const dir of Array.from(new Set(candidateDirs))) {
      const deviceName = await this.readDeviceNameFromNodeIdentityPath(path.join(dir, "node_identity.json"));
      if (!deviceName || deviceName !== userId) {
        continue;
      }
      const keyPath = path.join(dir, "node_private_key.pem");
      const keyPem = await this.readPemFile(keyPath);
      if (!keyPem) {
        continue;
      }
      return {
        keyPem,
        issuer: deviceName,
        subject: deviceName,
        sourcePath: keyPath
      };
    }
    return null;
  }
  async tryLoadUserSigningMaterial(userId, roots) {
    var _a;
    const fs = await importNodeModule$1("node:fs/promises");
    const path = await importNodeModule$1("node:path");
    for (const root of roots) {
      const userKeyPath = root.endsWith(".pem") ? root : path.join(root, "user_private_key.pem");
      const userConfigDir = root.endsWith(".pem") ? path.dirname(root) : root;
      const userConfigPath = path.join(userConfigDir, "user_config.json");
      try {
        const raw = await fs.readFile(userConfigPath, "utf8");
        const ownerConfig = parseOwnerConfigDocument(JSON.parse(raw));
        const configUserId = (_a = ownerConfig == null ? void 0 : ownerConfig.name) == null ? void 0 : _a.trim();
        if (!configUserId || configUserId !== userId) {
          continue;
        }
        const keyPem = await this.readPemFile(userKeyPath);
        if (!keyPem) {
          continue;
        }
        return {
          keyPem,
          issuer: userId,
          subject: userId,
          sourcePath: userKeyPath
        };
      } catch {
      }
    }
    return null;
  }
  async tryResolveDeviceNameFromSearchRoots(roots) {
    const path = await importNodeModule$1("node:path");
    const env = getProcessEnv();
    const fromEnv = trimToNull$1(env.BUCKYOS_THIS_DEVICE_NAME);
    if (fromEnv) {
      return fromEnv;
    }
    for (const key of ["BUCKYOS_THIS_DEVICE", "BUCKYOS_THIS_DEVICE_INFO"]) {
      const raw = trimToNull$1(env[key]);
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
          return parsed.name.trim();
        }
      } catch {
      }
    }
    for (const root of roots) {
      const nodeIdentityPath = path.join(root, "node_identity.json");
      const deviceName = await this.readDeviceNameFromNodeIdentityPath(nodeIdentityPath);
      if (deviceName) {
        return deviceName;
      }
    }
    return null;
  }
  async tryResolveZoneHostFromSearchRoots(roots) {
    const fs = await importNodeModule$1("node:fs/promises");
    const path = await importNodeModule$1("node:path");
    const env = getProcessEnv();
    const fromEnv = trimToNull$1(env.BUCKYOS_ZONE_HOST);
    if (fromEnv) {
      return fromEnv;
    }
    for (const root of roots) {
      const nodeIdentityPath = path.join(root, "node_identity.json");
      const metadata = await this.readNodeIdentityMetadata(nodeIdentityPath);
      if (!metadata) {
        continue;
      }
      if (metadata.zoneName) {
        return metadata.zoneName;
      }
      if (!metadata.zoneDid) {
        continue;
      }
      return resolveZoneHostFromDid(metadata.zoneDid);
    }
    for (const root of roots) {
      const userConfigPath = path.join(root, "user_config.json");
      try {
        const raw = await fs.readFile(userConfigPath, "utf8");
        const ownerConfig = parseOwnerConfigDocument(JSON.parse(raw));
        const zoneHost = resolveZoneHostFromDid(ownerConfig == null ? void 0 : ownerConfig.default_zone_did);
        if (!zoneHost) {
          continue;
        }
        return zoneHost;
      } catch {
      }
    }
    return null;
  }
  getMySettingsPath() {
    return this.profile.getMySettingsPath(this);
  }
  getConfiguredSystemConfigServiceUrl() {
    return trimToNull$1(this.config.systemConfigServiceUrl);
  }
  resolveAppServiceGatewayHost() {
    return trimToNull$1(getProcessEnv()[BUCKYOS_HOST_GATEWAY_ENV]) ?? DEFAULT_DOCKER_HOST_GATEWAY;
  }
  async signJwtWithEd25519(header, payload, privateKeyPem) {
    const crypto2 = await importNodeModule$1("node:crypto");
    const BufferCtor = ensureBuffer();
    const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
    const signature = crypto2.sign(
      null,
      BufferCtor.from(signingInput, "utf8"),
      crypto2.createPrivateKey({
        key: privateKeyPem,
        format: "pem"
      })
    );
    return `${signingInput}.${base64UrlEncode(signature)}`;
  }
}
const DEFAULT_HTTP_KEEPALIVE_MS = 15e3;
const DEFAULT_NATIVE_HOST = "127.0.0.1";
const DEFAULT_NATIVE_PORT = 3183;
const DEFAULT_NATIVE_CONNECT_TIMEOUT_MS = 5e3;
const DEFAULT_SUBSCRIBE_RECONNECT_DELAY_MS = 1e3;
const MAX_NATIVE_FRAME_SIZE = 1024 * 1024;
class KEventProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KEventProtocolError";
    this.code = code;
  }
}
const defaultFetcher = async (input, init) => {
  if (typeof fetch !== "function") {
    throw new Error("fetch is not available in this runtime");
  }
  return fetch(input, init);
};
function hasNodeRuntime() {
  var _a;
  const runtimeProcess = globalThis.process;
  return Boolean((_a = runtimeProcess == null ? void 0 : runtimeProcess.versions) == null ? void 0 : _a.node);
}
async function importNodeModule(moduleName) {
  if (hasNodeRuntime() && typeof require === "function") {
    return require(moduleName);
  }
  const dynamicImport = Function("name", "return import(name)");
  return dynamicImport(moduleName);
}
function normalizePatterns(patterns) {
  const normalized = (Array.isArray(patterns) ? patterns : [patterns]).map((pattern) => typeof pattern === "string" ? pattern.trim() : "").filter((pattern) => pattern.length > 0);
  if (normalized.length === 0) {
    throw new Error("kevent patterns must not be empty");
  }
  for (const pattern of normalized) {
    if (!pattern.startsWith("/")) {
      throw new Error(`kevent only supports global patterns: ${pattern}`);
    }
  }
  return normalized;
}
function normalizeKeepaliveMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_HTTP_KEEPALIVE_MS;
  }
  return Math.floor(value);
}
function buildStreamUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/stream`;
}
function delay(ms, signal) {
  if (signal == null ? void 0 : signal.aborted) {
    return Promise.reject(new Error("Operation aborted"));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("Operation aborted"));
    };
    const cleanup = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
function generateReaderId() {
  return `ts_kevent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function assertDaemonResponseOk(response) {
  if (response.status === "ok") {
    return response;
  }
  throw new KEventProtocolError(response.code || "INTERNAL", response.message || "Unknown kevent error");
}
function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Invalid kevent event payload");
  }
  const candidate = event;
  if (typeof candidate.eventid !== "string" || typeof candidate.source_node !== "string" || typeof candidate.source_pid !== "number" || typeof candidate.timestamp !== "number") {
    throw new Error("Invalid kevent event payload");
  }
  return {
    eventid: candidate.eventid,
    source_node: candidate.source_node,
    source_pid: candidate.source_pid,
    ingress_node: typeof candidate.ingress_node === "string" ? candidate.ingress_node : null,
    timestamp: candidate.timestamp,
    data: "data" in candidate ? candidate.data : null
  };
}
class AsyncEventQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }
  push(item) {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timeout) {
        clearTimeout(waiter.timeout);
      }
      waiter.resolve(item);
      return;
    }
    this.items.push(item);
  }
  async shift(timeoutMs) {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    if (timeoutMs === 0) {
      return null;
    }
    return new Promise((resolve) => {
      const waiter = {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        timeout: null
      };
      const cleanup = () => {
        if (waiter.timeout) {
          clearTimeout(waiter.timeout);
          waiter.timeout = null;
        }
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
      };
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          cleanup();
          resolve(null);
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }
  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) {
        continue;
      }
      if (waiter.timeout) {
        clearTimeout(waiter.timeout);
      }
      waiter.resolve(null);
    }
  }
}
class KEventReader {
  constructor() {
    this.queue = new AsyncEventQueue();
    this.closed = false;
    this.closePromise = null;
  }
  async pullEvent(timeoutMs) {
    return this.queue.shift(timeoutMs);
  }
  async pull_event(timeoutMs) {
    return this.pullEvent(timeoutMs);
  }
  enqueue(event) {
    this.queue.push(event);
  }
  isClosed() {
    return this.closed;
  }
  markClosed() {
    this.closed = true;
    this.queue.close();
  }
  async close() {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.markClosed();
    this.closePromise = this.closeTransport().catch((error) => {
      console.warn("kevent reader close failed:", error);
    }).then(() => void 0);
    return this.closePromise;
  }
}
class BrowserKEventReader extends KEventReader {
  constructor(streamUrl, patterns, keepaliveMs, fetcher, sessionTokenProvider, signal) {
    super();
    this.streamUrl = streamUrl;
    this.patterns = patterns;
    this.keepaliveMs = keepaliveMs;
    this.fetcher = fetcher;
    this.sessionTokenProvider = sessionTokenProvider;
    this.streamTask = null;
    this.controller = new AbortController();
    this.readyPromise = this.start();
    if (signal) {
      if (signal.aborted) {
        this.controller.abort();
      } else {
        signal.addEventListener("abort", () => {
          this.controller.abort();
        }, { once: true });
      }
    }
  }
  async waitUntilReady() {
    await this.readyPromise;
  }
  async start() {
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.sessionTokenProvider) {
      const token = await this.sessionTokenProvider();
      if (typeof token === "string" && token.trim().length > 0) {
        headers.Authorization = `Bearer ${token.trim()}`;
      }
    }
    const response = await this.fetcher(this.streamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        patterns: this.patterns,
        keepalive_ms: this.keepaliveMs
      }),
      cache: "no-store",
      credentials: "include",
      signal: this.controller.signal
    });
    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
      throw new Error(`kevent stream request failed: ${response.status}${detail ? ` ${detail}` : ""}`);
    }
    if (!response.body) {
      throw new Error("kevent stream response missing body");
    }
    let acked = false;
    let resolveAck = null;
    let rejectAck = null;
    const ackPromise = new Promise((resolve, reject) => {
      resolveAck = resolve;
      rejectAck = reject;
    });
    this.streamTask = this.consumeStream(response.body, (frame) => {
      if (frame.type === "ack") {
        acked = true;
        resolveAck == null ? void 0 : resolveAck();
        return;
      }
      if (frame.type === "event") {
        this.enqueue(validateEvent(frame.event));
        return;
      }
      if (frame.type === "error") {
        const error = new Error(frame.error || "kevent stream error");
        if (!acked) {
          rejectAck == null ? void 0 : rejectAck(error);
        } else {
          console.warn("kevent stream error:", error.message);
        }
      }
    }).then(() => {
      if (!acked) {
        rejectAck == null ? void 0 : rejectAck(new Error("kevent stream closed before ack"));
      }
    }).catch((error) => {
      if (!acked) {
        rejectAck == null ? void 0 : rejectAck(error instanceof Error ? error : new Error(toErrorMessage(error)));
        return;
      }
      if (!this.controller.signal.aborted) {
        console.warn("kevent browser stream stopped with error:", error);
      }
    }).finally(() => {
      this.markClosed();
    });
    await ackPromise;
  }
  async consumeStream(body, onFrame) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!this.controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        buffer = this.processFrameBuffer(buffer, onFrame);
      }
      buffer += decoder.decode();
      buffer = this.processFrameBuffer(buffer, onFrame);
      if (buffer.trim().length > 0) {
        this.handleFrameLine(buffer, onFrame);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
      }
    }
  }
  processFrameBuffer(buffer, onFrame) {
    let cursor = buffer;
    while (true) {
      const newlineIndex = cursor.indexOf("\n");
      if (newlineIndex < 0) {
        return cursor;
      }
      const line = cursor.slice(0, newlineIndex);
      cursor = cursor.slice(newlineIndex + 1);
      this.handleFrameLine(line, onFrame);
    }
  }
  handleFrameLine(line, onFrame) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const frame = JSON.parse(trimmed);
    onFrame(frame);
  }
  async closeTransport() {
    this.controller.abort();
    if (this.streamTask) {
      try {
        await this.streamTask;
      } catch (error) {
        if (!this.controller.signal.aborted) {
          console.warn("kevent browser stream stopped with error:", error);
        }
      }
    }
  }
}
class NativeKEventProtocolClient {
  constructor(host, port, connectTimeoutMs, connector) {
    this.host = host;
    this.port = port;
    this.connectTimeoutMs = connectTimeoutMs;
    this.connector = connector;
    this.socket = null;
    this.connectPromise = null;
    this.closed = false;
    this.serial = Promise.resolve();
    this.readBuffer = new Uint8Array(0);
    this.pending = [];
  }
  async call(request) {
    const task = this.serial.then(() => this.callInternal(request));
    this.serial = task.then(() => void 0, () => void 0);
    return task;
  }
  async close() {
    this.closed = true;
    this.rejectAllPending(new Error("kevent native connection closed"));
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.end();
    }
  }
  async callInternal(request) {
    if (this.closed) {
      throw new Error("kevent native connection is closed");
    }
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket) {
      throw new Error("kevent native socket is not connected");
    }
    const payload = new TextEncoder().encode(JSON.stringify(request));
    if (payload.length === 0 || payload.length > MAX_NATIVE_FRAME_SIZE) {
      throw new Error(`invalid kevent native request payload size: ${payload.length}`);
    }
    const frame = new Uint8Array(4 + payload.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, payload.length);
    frame.set(payload, 4);
    return new Promise((resolve, reject) => {
      const pendingItem = { resolve, reject };
      this.pending.push(pendingItem);
      socket.write(frame, (error) => {
        if (!error) {
          return;
        }
        const index = this.pending.indexOf(pendingItem);
        if (index >= 0) {
          this.pending.splice(index, 1);
        }
        reject(error instanceof Error ? error : new Error(toErrorMessage(error)));
      });
    });
  }
  async ensureConnected() {
    if (this.socket) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.connect().finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
  }
  async connect() {
    const socket = await this.connector(this.host, this.port, this.connectTimeoutMs);
    this.socket = socket;
    if (typeof socket.setNoDelay === "function") {
      socket.setNoDelay(true);
    }
    socket.on("data", (chunk) => {
      try {
        this.handleSocketData(toUint8Array(chunk));
      } catch (error) {
        this.handleSocketFailure(error instanceof Error ? error : new Error(toErrorMessage(error)));
      }
    });
    socket.once("end", () => {
      this.handleSocketFailure(new Error("kevent native socket ended"));
    });
    socket.once("close", () => {
      this.handleSocketFailure(new Error("kevent native socket closed"));
    });
    socket.once("error", (error) => {
      this.handleSocketFailure(error);
    });
  }
  handleSocketData(chunk) {
    this.readBuffer = concatUint8Arrays(this.readBuffer, chunk);
    while (this.readBuffer.length >= 4) {
      const frameLength = new DataView(
        this.readBuffer.buffer,
        this.readBuffer.byteOffset,
        this.readBuffer.byteLength
      ).getUint32(0);
      if (frameLength === 0 || frameLength > MAX_NATIVE_FRAME_SIZE) {
        throw new Error(`invalid kevent native frame length: ${frameLength}`);
      }
      if (this.readBuffer.length < 4 + frameLength) {
        return;
      }
      const payloadBytes = this.readBuffer.slice(4, 4 + frameLength);
      this.readBuffer = this.readBuffer.slice(4 + frameLength);
      const response = JSON.parse(new TextDecoder().decode(payloadBytes));
      const pendingItem = this.pending.shift();
      if (!pendingItem) {
        continue;
      }
      pendingItem.resolve(response);
    }
  }
  handleSocketFailure(error) {
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.destroy(error);
      } catch {
      }
    }
    if (!this.closed) {
      this.rejectAllPending(error);
    }
  }
  rejectAllPending(error) {
    while (this.pending.length > 0) {
      const pendingItem = this.pending.shift();
      pendingItem == null ? void 0 : pendingItem.reject(error);
    }
  }
}
class NativeKEventReader extends KEventReader {
  constructor(client, readerId) {
    super();
    this.client = client;
    this.readerId = readerId;
  }
  static async create(patterns, options) {
    const client = new NativeKEventProtocolClient(
      options.nativeHost,
      options.nativePort,
      options.nativeConnectTimeoutMs,
      options.nativeConnector
    );
    const readerId = generateReaderId();
    try {
      const response = await client.call({
        op: "register_reader",
        reader_id: readerId,
        patterns
      });
      assertDaemonResponseOk(response);
      return new NativeKEventReader(client, readerId);
    } catch (error) {
      await client.close();
      throw error;
    }
  }
  async pullEvent(timeoutMs) {
    if (this.isClosed()) {
      return null;
    }
    const response = await this.client.call({
      op: "pull_event",
      reader_id: this.readerId,
      timeout_ms: typeof timeoutMs === "number" ? Math.max(0, Math.floor(timeoutMs)) : void 0
    });
    const ok = assertDaemonResponseOk(response);
    return ok.event ? validateEvent(ok.event) : null;
  }
  async closeTransport() {
    try {
      const response = await this.client.call({
        op: "unregister_reader",
        reader_id: this.readerId
      });
      assertDaemonResponseOk(response);
    } catch (error) {
      if (!(error instanceof Error) || !/closed/i.test(error.message)) {
        console.warn("kevent unregister failed:", error);
      }
    } finally {
      await this.client.close();
    }
  }
}
async function defaultNativeConnector(host, port, connectTimeoutMs) {
  if (!hasNodeRuntime()) {
    throw new Error("native kevent requires Node.js");
  }
  const net = await importNodeModule("node:net");
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        socket.destroy(new Error(`kevent native connect timeout after ${connectTimeoutMs}ms`));
      } catch {
      }
      reject(new Error(`kevent native connect timeout after ${connectTimeoutMs}ms`));
    }, connectTimeoutMs);
    const onConnect = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(socket);
    };
    const onError = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        socket.destroy(error);
      } catch {
      }
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      if (typeof socket.off === "function") {
        socket.off("connect", onConnect);
        socket.off("error", onError);
      } else if (typeof socket.removeListener === "function") {
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
      }
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}
function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error("Unsupported socket data chunk");
}
function concatUint8Arrays(left, right) {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}
class KEventClient {
  constructor(options) {
    this.mode = options.mode;
    this.streamUrl = buildStreamUrl(options.streamUrl ?? "/kapi/kevent");
    this.nativeHost = options.nativeHost ?? DEFAULT_NATIVE_HOST;
    this.nativePort = options.nativePort ?? DEFAULT_NATIVE_PORT;
    this.nativeConnectTimeoutMs = options.nativeConnectTimeoutMs ?? DEFAULT_NATIVE_CONNECT_TIMEOUT_MS;
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.sessionTokenProvider = options.sessionTokenProvider ?? null;
    this.nativeConnector = options.nativeConnector ?? defaultNativeConnector;
  }
  async createEventReader(patterns, options = {}) {
    const normalizedPatterns = normalizePatterns(patterns);
    if (this.mode === "browser") {
      const reader = new BrowserKEventReader(
        this.streamUrl,
        normalizedPatterns,
        normalizeKeepaliveMs(options.keepaliveMs),
        this.fetcher,
        this.sessionTokenProvider,
        options.signal
      );
      try {
        await reader.waitUntilReady();
        return reader;
      } catch (error) {
        await reader.close();
        throw error;
      }
    }
    return NativeKEventReader.create(normalizedPatterns, {
      nativeHost: this.nativeHost,
      nativePort: this.nativePort,
      nativeConnectTimeoutMs: this.nativeConnectTimeoutMs,
      nativeConnector: this.nativeConnector
    });
  }
  async create_event_reader(patterns, options = {}) {
    return this.createEventReader(patterns, options);
  }
  async subscribe(patterns, callback, options = {}) {
    const normalizedPatterns = normalizePatterns(patterns);
    const abortController = new AbortController();
    const reconnectDelayMs = typeof options.reconnectDelayMs === "number" && options.reconnectDelayMs >= 0 ? Math.floor(options.reconnectDelayMs) : DEFAULT_SUBSCRIBE_RECONNECT_DELAY_MS;
    let currentReader = null;
    let closed = false;
    if (options.signal) {
      if (options.signal.aborted) {
        abortController.abort();
        closed = true;
      } else {
        options.signal.addEventListener("abort", () => {
          abortController.abort();
        }, { once: true });
      }
    }
    const run = (async () => {
      while (!closed && !abortController.signal.aborted) {
        try {
          currentReader = await this.createEventReader(normalizedPatterns, {
            ...options,
            signal: abortController.signal
          });
          while (!closed && !abortController.signal.aborted) {
            const event = await currentReader.pullEvent();
            if (!event) {
              break;
            }
            try {
              await callback(event);
            } catch (error) {
              console.error("kevent callback failed:", error);
            }
          }
        } catch (error) {
          if (!closed && !abortController.signal.aborted) {
            console.warn("kevent subscription disconnected, will retry:", error);
          }
        } finally {
          const reader = currentReader;
          currentReader = null;
          if (reader) {
            await reader.close();
          }
        }
        if (closed || abortController.signal.aborted) {
          break;
        }
        try {
          await delay(reconnectDelayMs, abortController.signal);
        } catch {
          break;
        }
      }
    })();
    return {
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        abortController.abort();
        const reader = currentReader;
        currentReader = null;
        if (reader) {
          await reader.close();
        }
        await run.catch(() => void 0);
      }
    };
  }
}
const WEB3_BRIDGE_HOST = "web3.buckyos.ai";
const BS_SERVICE_VERIFY_HUB = "verify-hub";
const BS_SERVICE_TASK_MANAGER = "task-manager";
const activeRuntimeContext = {
  runtime: null
};
function isBrowserRuntime() {
  return typeof window !== "undefined";
}
function getNodeEnv() {
  const runtimeProcess = globalThis.process;
  return (runtimeProcess == null ? void 0 : runtimeProcess.env) ?? {};
}
function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function isBrowserStorageAvailable() {
  return typeof localStorage !== "undefined";
}
function getSettingsPathSegments(settingName) {
  if (!settingName) {
    return [];
  }
  return settingName.split(/[./]/).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}
function getSettingValue(settings, settingName) {
  const segments = getSettingsPathSegments(settingName);
  if (segments.length === 0) {
    return settings;
  }
  let current = settings;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
      return void 0;
    }
    current = current[segment];
  }
  return current;
}
function setSettingValue(settings, settingName, value) {
  const segments = getSettingsPathSegments(settingName);
  if (segments.length === 0) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("settingValue must be a JSON object when settingName is null");
    }
    return value;
  }
  const nextSettings = Array.isArray(settings) ? {} : { ...settings };
  let current = nextSettings;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const previous = current[segment];
    const next = previous && typeof previous === "object" && !Array.isArray(previous) ? { ...previous } : {};
    current[segment] = next;
    current = next;
  }
  current[segments[segments.length - 1]] = value;
  return nextSettings;
}
function parseSettingValue(settingValue) {
  try {
    return JSON.parse(settingValue);
  } catch {
    return settingValue;
  }
}
function inferNodeRuntimeType() {
  const env = getNodeEnv();
  if (trimToNull(env.app_instance_config)) {
    return RuntimeType.AppService;
  }
  return RuntimeType.AppClient;
}
function detectHostRuntimeType() {
  var _a;
  if (typeof window !== "undefined") {
    if (window.BuckyApi) {
      return RuntimeType.AppRuntime;
    }
    return RuntimeType.Browser;
  }
  const runtimeProcess = globalThis.process;
  if ((_a = runtimeProcess == null ? void 0 : runtimeProcess.versions) == null ? void 0 : _a.node) {
    return RuntimeType.NodeJS;
  }
  return RuntimeType.Unknown;
}
function toAbsoluteOrigin(url) {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    return new URL(url, base).origin;
  } catch {
    return null;
  }
}
function setActiveRuntime(runtime) {
  activeRuntimeContext.runtime = runtime;
}
function getActiveRuntimeType() {
  var _a;
  return ((_a = activeRuntimeContext.runtime) == null ? void 0 : _a.getConfig().runtimeType) ?? detectHostRuntimeType();
}
function getActiveZoneGatewayOrigin() {
  var _a;
  const runtime = activeRuntimeContext.runtime;
  if (runtime) {
    return toAbsoluteOrigin(runtime.getSystemConfigServiceURL());
  }
  if (typeof window !== "undefined" && ((_a = window.location) == null ? void 0 : _a.origin)) {
    return window.location.origin;
  }
  return null;
}
async function getActiveSessionToken() {
  const runtime = activeRuntimeContext.runtime;
  if (!runtime) {
    return null;
  }
  return runtime.ensureSessionTokenReady();
}
class BuckyOSSDK {
  constructor(target) {
    this.currentRuntime = null;
    this.currentAccountInfo = null;
    this.currentKEventClient = null;
    this.target = target;
  }
  async initBuckyOS(appid, config = null) {
    var _a;
    const finalConfig = this.buildRuntimeConfig(appid, config);
    if (this.target !== "node" && isBrowserRuntime() && !config) {
      localStorage.removeItem("zone_host_name");
      let zoneHostName = localStorage.getItem("zone_host_name_v2");
      if (zoneHostName) {
        finalConfig.zoneHost = zoneHostName;
      } else {
        zoneHostName = await this.tryGetZoneHostName(appid, window.location.host, finalConfig.defaultProtocol);
        localStorage.setItem("zone_host_name_v2", zoneHostName);
        finalConfig.zoneHost = zoneHostName;
      }
    }
    (_a = this.currentRuntime) == null ? void 0 : _a.stopAutoRenew();
    this.currentKEventClient = null;
    this.currentRuntime = new BuckyOSRuntime(finalConfig);
    await this.currentRuntime.initialize();
    setActiveRuntime(this.currentRuntime);
    this.syncCurrentAccountInfoFromRuntime();
  }
  getBuckyOSConfig() {
    var _a;
    return ((_a = this.currentRuntime) == null ? void 0 : _a.getConfig()) ?? null;
  }
  getRuntimeType() {
    if (this.currentRuntime) {
      return this.currentRuntime.getConfig().runtimeType;
    }
    return this.detectEnvironmentRuntimeType();
  }
  getAppId() {
    if (this.currentRuntime) {
      return this.currentRuntime.getAppId();
    }
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
  }
  attachEvent(eventName, callback) {
  }
  removeEvent(cookieId) {
  }
  getKEventClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    if (this.currentKEventClient) {
      return this.currentKEventClient;
    }
    const runtimeType = this.currentRuntime.getConfig().runtimeType;
    const mode = runtimeType === RuntimeType.Browser || runtimeType === RuntimeType.AppRuntime ? "browser" : "native";
    this.currentKEventClient = new KEventClient({
      mode,
      streamUrl: this.currentRuntime.getZoneServiceURL("kevent"),
      sessionTokenProvider: this.currentRuntime.ensureSessionTokenReady.bind(this.currentRuntime)
    });
    return this.currentKEventClient;
  }
  async createEventReader(patterns, options = {}) {
    return this.getKEventClient().createEventReader(patterns, options);
  }
  async create_event_reader(patterns, options = {}) {
    return this.createEventReader(patterns, options);
  }
  async subscribeKEvent(patterns, callback, options = {}) {
    return this.getKEventClient().subscribe(patterns, callback, options);
  }
  async getAccountInfo() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return null;
    }
    this.syncCurrentAccountInfoFromRuntime();
    if (this.currentRuntime.getConfig().runtimeType !== RuntimeType.Browser) {
      return this.currentAccountInfo;
    }
    const cachedUserInfo = isBrowserStorageAvailable() ? getBrowserUserInfo() : null;
    if (cachedUserInfo) {
      this.currentAccountInfo = {
        user_name: cachedUserInfo.user_name,
        user_id: cachedUserInfo.user_id,
        user_type: cachedUserInfo.user_type,
        session_token: this.currentRuntime.getSessionToken() ?? "",
        refresh_token: void 0
      };
      return this.currentAccountInfo;
    }
    const refreshedUserInfo = await this.currentRuntime.refreshBrowserSession();
    if (!refreshedUserInfo) {
      return null;
    }
    this.currentAccountInfo = {
      user_name: refreshedUserInfo.user_name,
      user_id: refreshedUserInfo.user_id,
      user_type: refreshedUserInfo.user_type,
      session_token: this.currentRuntime.getSessionToken() ?? "",
      refresh_token: void 0
    };
    return this.currentAccountInfo;
  }
  async loginByPassword(username, password) {
    var _a, _b;
    const appId = this.getAppId();
    if (appId == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return null;
    }
    const loginNonce = Date.now();
    const passwordHash = hashPassword(username, password, loginNonce);
    if (isBrowserStorageAvailable()) {
      localStorage.removeItem(`buckyos.account_info.${appId}`);
    }
    try {
      const verifyHubClient = this.getVerifyHubClient();
      verifyHubClient.setSeq(loginNonce);
      const accountResponse = await verifyHubClient.loginByPassword({
        username,
        password: passwordHash,
        appid: appId,
        source_url: typeof window !== "undefined" ? window.location.href : void 0
      });
      const normalized = VerifyHubClient.normalizeLoginResponse(accountResponse);
      const accountInfo = {
        user_name: normalized.user_name,
        user_id: normalized.user_id,
        user_type: normalized.user_type,
        session_token: normalized.session_token,
        refresh_token: normalized.refresh_token
      };
      if (isBrowserStorageAvailable()) {
        saveLocalAccountInfo(appId, accountInfo);
        saveBrowserUserInfo({
          user_name: accountInfo.user_name,
          user_id: accountInfo.user_id,
          user_type: normalized.user_type
        });
      }
      this.currentAccountInfo = accountInfo;
      (_a = this.currentRuntime) == null ? void 0 : _a.setSessionToken(accountInfo.session_token);
      (_b = this.currentRuntime) == null ? void 0 : _b.setRefreshToken(accountInfo.refresh_token ?? null);
      return accountInfo;
    } catch (error) {
      console.error("login failed: ", error);
      throw error;
    }
  }
  async loginByRuntimeSession() {
    const runtime = this.currentRuntime;
    if (runtime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return null;
    }
    await runtime.login();
    this.syncCurrentAccountInfoFromRuntime();
    return this.currentAccountInfo;
  }
  async loginByBrowserSSO() {
    const runtime = this.currentRuntime;
    if (runtime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    const appId = this.getAppId();
    if (appId == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    if (isBrowserStorageAvailable()) {
      cleanLocalAccountInfo(appId);
    }
    const zoneHostName = this.getZoneHostName();
    if (zoneHostName == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    try {
      const authClient = new AuthClient(zoneHostName, appId);
      await authClient.login();
    } catch (error) {
      console.error("login failed: ", error);
      throw error;
    }
  }
  async login() {
    if (this.usesRuntimeManagedSession()) {
      return this.loginByRuntimeSession();
    }
    await this.loginByBrowserSSO();
    return this.currentAccountInfo;
  }
  logout(cleanAccountInfo = true) {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    const appId = this.getAppId();
    if (appId == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    if (cleanAccountInfo) {
      void this.currentRuntime.logoutBrowserSSO();
    }
    if (cleanAccountInfo && isBrowserStorageAvailable()) {
      cleanLocalAccountInfo(appId);
    }
    this.currentAccountInfo = null;
    this.currentKEventClient = null;
    this.currentRuntime.clearAuthState();
  }
  async getAppSetting(settingName = null) {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    const settings = await this.currentRuntime.getMySettings();
    return getSettingValue(settings, settingName);
  }
  async setAppSetting(settingName = null, settingValue) {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    const currentSettings = await this.currentRuntime.getMySettings();
    const nextSettings = setSettingValue(
      currentSettings && typeof currentSettings === "object" && !Array.isArray(currentSettings) ? { ...currentSettings } : {},
      settingName,
      parseSettingValue(settingValue)
    );
    await this.currentRuntime.updateAllMySettings(nextSettings);
  }
  getCurrentWalletUser() {
    if (typeof window === "undefined") {
      throw new Error("BuckyApi is only available in browser runtime");
    }
    return (async () => {
      const result = await window.BuckyApi.getCurrentUser();
      if (result.code === 0) {
        return result.data;
      }
      console.error("BuckyApi.getCurrentUser failed: ", result.message);
      return null;
    })();
  }
  walletSignWithActiveDid(payloads) {
    if (typeof window === "undefined") {
      throw new Error("BuckyApi is only available in browser runtime");
    }
    return (async () => {
      var _a, _b;
      const result = await window.BuckyApi.signJsonWithActiveDid(payloads);
      if (result.code === 0) {
        return {
          signatures: Array.isArray((_a = result.data) == null ? void 0 : _a.signatures) ? result.data.signatures : [],
          pwd_hash: typeof ((_b = result.data) == null ? void 0 : _b.pwd_hash) === "string" ? result.data.pwd_hash : null
        };
      }
      console.error("BuckyApi.signWithActiveDid failed: ", result.message);
      return null;
    })();
  }
  async openExternalUrl(url) {
    if (typeof window === "undefined") {
      throw new Error("openExternalUrl is only available in browser runtime");
    }
    const buckyApi = window.BuckyApi;
    if (typeof (buckyApi == null ? void 0 : buckyApi.openExternalUrl) === "function") {
      await buckyApi.openExternalUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }
  getZoneHostName() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return null;
    }
    return this.currentRuntime.getZoneHostName();
  }
  getZoneServiceURL(serviceName) {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getZoneServiceURL(serviceName);
  }
  getServiceRpcClient(serviceName) {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    this.syncCurrentAccountInfoFromRuntime();
    return this.currentRuntime.getServiceRpcClient(serviceName);
  }
  getVerifyHubClient() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getVerifyHubClient();
  }
  getSystemConfigClient() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getSystemConfigClient();
  }
  getTaskManagerClient() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getTaskManagerClient();
  }
  getWorkflowClient() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getWorkflowClient();
  }
  getAiccClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getAiccClient();
  }
  getMsgQueueClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getMsgQueueClient();
  }
  getMsgCenterClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getMsgCenterClient();
  }
  getRepoClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getRepoClient();
  }
  buildRuntimeConfig(appid, config) {
    if (config) {
      let runtimeType = config.runtimeType;
      if (runtimeType === RuntimeType.NodeJS && this.target !== "browser") {
        runtimeType = inferNodeRuntimeType();
      }
      return {
        ...DEFAULT_CONFIG,
        ...config,
        appId: config.appId || appid,
        runtimeType
      };
    }
    if (this.target === "browser") {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: this.detectEnvironmentRuntimeType(),
        defaultProtocol: typeof window !== "undefined" ? window.location.protocol + "//" : "http://"
      };
    }
    if (this.target === "node") {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: inferNodeRuntimeType(),
        defaultProtocol: "https://",
        zoneHost: trimToNull(getNodeEnv().BUCKYOS_ZONE_HOST) ?? ""
      };
    }
    if (isBrowserRuntime()) {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: this.detectEnvironmentRuntimeType(),
        defaultProtocol: window.location.protocol + "//"
      };
    }
    return {
      ...DEFAULT_CONFIG,
      appId: appid,
      runtimeType: inferNodeRuntimeType(),
      defaultProtocol: "https://",
      zoneHost: trimToNull(getNodeEnv().BUCKYOS_ZONE_HOST) ?? ""
    };
  }
  async tryGetZoneHostName(appid, host, defaultProtocol) {
    const zoneFromDoc = await this.fetchZoneHostFromIdentifierDoc(defaultProtocol + host + "/1.0/identifiers/self");
    if (zoneFromDoc) {
      return zoneFromDoc;
    }
    const upHost = host.split(".").slice(1).join(".");
    if (!upHost) {
      return host;
    }
    const zoneFromParent = await this.fetchZoneHostFromIdentifierDoc(defaultProtocol + upHost + "/1.0/identifiers/self");
    if (zoneFromParent) {
      return zoneFromParent;
    }
    return host;
  }
  async fetchZoneHostFromIdentifierDoc(url) {
    try {
      const response = await fetch(url);
      if (response.status !== 200) {
        return null;
      }
      const doc = await response.json();
      const hostname = typeof doc.hostname === "string" ? doc.hostname.trim() : "";
      if (hostname.length > 0) {
        return hostname;
      }
      if (typeof doc.id === "string") {
        const match = doc.id.match(/^did:web:([^/?#]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  syncCurrentAccountInfoFromRuntime() {
    if (this.currentRuntime == null) {
      return;
    }
    const sessionToken = this.currentRuntime.getSessionToken();
    if (!sessionToken) {
      return;
    }
    const claims = parseSessionTokenClaims(sessionToken);
    const userId = typeof (claims == null ? void 0 : claims.sub) === "string" ? claims.sub : typeof (claims == null ? void 0 : claims.userid) === "string" ? claims.userid : this.currentRuntime.getOwnerUserId() ?? "root";
    const userType = typeof (claims == null ? void 0 : claims.user_type) === "string" ? claims.user_type : this.currentRuntime.getConfig().runtimeType === RuntimeType.AppService ? "service" : void 0;
    this.currentAccountInfo = {
      user_name: userId,
      user_id: userId,
      user_type: userType,
      session_token: sessionToken,
      refresh_token: this.currentRuntime.getRefreshToken() ?? void 0
    };
  }
  usesRuntimeManagedSession() {
    if (this.currentRuntime == null) {
      return false;
    }
    const runtimeType = this.currentRuntime.getConfig().runtimeType;
    return runtimeType === RuntimeType.AppClient || runtimeType === RuntimeType.AppService;
  }
  detectEnvironmentRuntimeType() {
    var _a, _b;
    if (this.target === "browser") {
      if (typeof window !== "undefined" && window.BuckyApi) {
        return RuntimeType.AppRuntime;
      }
      return typeof window !== "undefined" ? RuntimeType.Browser : RuntimeType.Unknown;
    }
    if (this.target === "node") {
      const runtimeProcess2 = globalThis.process;
      if ((_a = runtimeProcess2 == null ? void 0 : runtimeProcess2.versions) == null ? void 0 : _a.node) {
        return inferNodeRuntimeType();
      }
      return RuntimeType.Unknown;
    }
    if (typeof window !== "undefined") {
      if (window.BuckyApi) {
        return RuntimeType.AppRuntime;
      }
      return RuntimeType.Browser;
    }
    const runtimeProcess = globalThis.process;
    if ((_b = runtimeProcess == null ? void 0 : runtimeProcess.versions) == null ? void 0 : _b.node) {
      return RuntimeType.NodeJS;
    }
    return RuntimeType.Unknown;
  }
}
function createSDKModule(target) {
  const sdk = new BuckyOSSDK(target);
  const api = {
    initBuckyOS: sdk.initBuckyOS.bind(sdk),
    getBuckyOSConfig: sdk.getBuckyOSConfig.bind(sdk),
    getRuntimeType: sdk.getRuntimeType.bind(sdk),
    getAppId: sdk.getAppId.bind(sdk),
    getKEventClient: sdk.getKEventClient.bind(sdk),
    createEventReader: sdk.createEventReader.bind(sdk),
    create_event_reader: sdk.create_event_reader.bind(sdk),
    subscribeKEvent: sdk.subscribeKEvent.bind(sdk),
    attachEvent: sdk.attachEvent.bind(sdk),
    removeEvent: sdk.removeEvent.bind(sdk),
    getAccountInfo: sdk.getAccountInfo.bind(sdk),
    loginByPassword: sdk.loginByPassword.bind(sdk),
    loginByBrowserSSO: sdk.loginByBrowserSSO.bind(sdk),
    loginByRuntimeSession: sdk.loginByRuntimeSession.bind(sdk),
    login: sdk.login.bind(sdk),
    logout: sdk.logout.bind(sdk),
    getAppSetting: sdk.getAppSetting.bind(sdk),
    setAppSetting: sdk.setAppSetting.bind(sdk),
    getCurrentWalletUser: sdk.getCurrentWalletUser.bind(sdk),
    walletSignWithActiveDid: sdk.walletSignWithActiveDid.bind(sdk),
    openExternalUrl: sdk.openExternalUrl.bind(sdk),
    getZoneHostName: sdk.getZoneHostName.bind(sdk),
    getZoneServiceURL: sdk.getZoneServiceURL.bind(sdk),
    getServiceRpcClient: sdk.getServiceRpcClient.bind(sdk),
    getVerifyHubClient: sdk.getVerifyHubClient.bind(sdk),
    getSystemConfigClient: sdk.getSystemConfigClient.bind(sdk),
    getTaskManagerClient: sdk.getTaskManagerClient.bind(sdk),
    getWorkflowClient: sdk.getWorkflowClient.bind(sdk),
    getAiccClient: sdk.getAiccClient.bind(sdk),
    getMsgQueueClient: sdk.getMsgQueueClient.bind(sdk),
    getMsgCenterClient: sdk.getMsgCenterClient.bind(sdk),
    getRepoClient: sdk.getRepoClient.bind(sdk)
  };
  return {
    ...api,
    buckyos: {
      kRPCClient,
      AuthClient,
      ...api,
      hashPassword
    }
  };
}
const WORKER_SOURCE = (
  /* js */
  `
"use strict";
self.onmessage = async function (e) {
    var file = e.data.file;
    var chunkSize = e.data.chunkSize;
    var fileSize = file.size;
    try {
        var offset = 0;
        var index = 0;
        while (offset < fileSize) {
            var end = Math.min(offset + chunkSize, fileSize);
            var buf = await file.slice(offset, end).arrayBuffer();
            var hashBuf = await crypto.subtle.digest("SHA-256", buf);
            var hash = new Uint8Array(hashBuf);
            self.postMessage(
                { type: "chunk", index: index, hash: hash, offset: offset, length: end - offset },
                [hashBuf]
            );
            offset = end;
            index++;
        }
        self.postMessage({ type: "done" });
    } catch (err) {
        self.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
    }
};
`
);
let cachedWorkerUrl = null;
function getWorkerBlobUrl() {
  if (!cachedWorkerUrl) {
    const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
    cachedWorkerUrl = URL.createObjectURL(blob);
  }
  return cachedWorkerUrl;
}
function isHashWorkerAvailable() {
  return typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}
function hashFileInWorker(file, chunkSize) {
  let progressCb = null;
  let cumulativeBytes = 0;
  const chunks = [];
  const result = new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(getWorkerBlobUrl());
    } catch {
      reject(new Error("Failed to create hash worker"));
      return;
    }
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "chunk") {
        const r = {
          index: msg.index,
          hash: msg.hash,
          offset: msg.offset,
          length: msg.length
        };
        chunks.push(r);
        cumulativeBytes += r.length;
        if (progressCb)
          progressCb(cumulativeBytes);
      } else if (msg.type === "done") {
        worker.terminate();
        resolve(chunks);
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message ?? "Worker hash error"));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message ?? "Worker error"));
    };
    worker.postMessage({ file, chunkSize });
  });
  return {
    result,
    onProgress(cb) {
      progressCb = cb;
    }
  };
}
class NdmError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "NdmError";
  }
}
class NdmStoreApiError extends Error {
  constructor(status, errorCode, message, responseBody) {
    super(message ?? `NDM store API request failed with status ${status}`);
    this.name = "NdmStoreApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.responseBody = responseBody;
  }
}
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;
const QCID_HASH_PIECE_SIZE = 4096;
const MIN_QCID_FILE_SIZE = QCID_HASH_PIECE_SIZE * 3;
const sessionRegistry = /* @__PURE__ */ new Map();
let sessionCounter = 0;
function generateSessionId() {
  sessionCounter += 1;
  return `import-${Date.now()}-${sessionCounter}`;
}
const browserProvider = {
  getCapabilities() {
    return {
      canRevealRealPath: false,
      canUseNDMCache: false,
      canUseNDMStore: false,
      canPickDirectory: typeof HTMLInputElement !== "undefined" && "webkitdirectory" in HTMLInputElement.prototype,
      canPickMixed: false
    };
  },
  pickFiles(options) {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      if (options.mode === "single_dir") {
        if (!this.getCapabilities().canPickDirectory) {
          reject(new NdmError("DIRECTORY_NOT_SUPPORTED", "This browser does not support directory selection"));
          return;
        }
        input.webkitdirectory = true;
      } else if (options.mode === "multi_file" || options.mode === "mixed") {
        input.multiple = true;
      }
      if (options.accept && options.accept.length > 0 && options.mode !== "single_dir") {
        input.accept = options.accept.join(",");
      }
      let settled = false;
      input.addEventListener("change", () => {
        if (settled)
          return;
        settled = true;
        const files = input.files;
        if (!files || files.length === 0) {
          reject(new NdmError("USER_CANCELLED", "No files selected"));
          return;
        }
        resolve(Array.from(files));
      });
      const onFocus = () => {
        setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new NdmError("USER_CANCELLED", "User cancelled file selection"));
          }
          window.removeEventListener("focus", onFocus);
        }, 500);
      };
      window.addEventListener("focus", onFocus);
      input.click();
    });
  }
};
let currentProvider = browserProvider;
function setImportProvider(provider) {
  currentProvider = provider;
}
function getImportProvider() {
  return currentProvider;
}
function defaultStoreFetcher(input, init) {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch(input, init);
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch(input, init);
  }
  throw new Error("fetch is not available in this runtime");
}
function normalizeEndpoint$1(endpoint) {
  return endpoint.replace(/\/+$/, "");
}
function isChunkQuickHash(quickHash) {
  try {
    return ObjId.fromString(quickHash).isChunk();
  } catch {
    return false;
  }
}
function encodeLookupQueryValue(value) {
  return encodeURIComponent(value).replace(/%3A/gi, ":");
}
function ensureStoreApiSupportedRuntime() {
  if (getActiveRuntimeType() === RuntimeType.Browser) {
    throw new NdmError(
      "STORE_API_NOT_SUPPORTED_IN_RUNTIME",
      "NDM structured store APIs are not available in pure Browser runtime"
    );
  }
}
function resolveStoreEndpoint(options) {
  if (options == null ? void 0 : options.endpoint) {
    return normalizeEndpoint$1(options.endpoint);
  }
  const activeOrigin = getActiveZoneGatewayOrigin();
  if (activeOrigin) {
    return normalizeEndpoint$1(activeOrigin);
  }
  throw new NdmError(
    "STORE_API_ENDPOINT_REQUIRED",
    "NDM structured store endpoint is unknown; pass options.endpoint or call initBuckyOS first"
  );
}
async function callStoreApi(methodName, requestBody, options) {
  var _a;
  ensureStoreApiSupportedRuntime();
  const endpoint = resolveStoreEndpoint(options);
  const fetcher = (options == null ? void 0 : options.fetcher) ?? defaultStoreFetcher;
  const sessionToken = (options == null ? void 0 : options.sessionToken) !== void 0 ? options.sessionToken : await getActiveSessionToken();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(options == null ? void 0 : options.headers) ?? {}
  };
  if (sessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  const response = await fetcher(`${endpoint}/ndm/v1/store/${methodName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    credentials: (options == null ? void 0 : options.credentials) ?? "include"
  });
  if (response.status === 204) {
    await ((_a = response.body) == null ? void 0 : _a.cancel());
    return void 0;
  }
  const contentType = response.headers.get("content-type") ?? "";
  const isJsonResponse = contentType.includes("application/json");
  const responseBody = isJsonResponse ? await response.json() : await response.text();
  if (!response.ok) {
    const errorBody = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody) ? responseBody : null;
    throw new NdmStoreApiError(
      response.status,
      errorBody == null ? void 0 : errorBody.error,
      (errorBody == null ? void 0 : errorBody.message) ?? (typeof responseBody === "string" && responseBody.length > 0 ? responseBody : `NDM store API request failed with status ${response.status}`),
      responseBody
    );
  }
  return responseBody;
}
async function getZoneGatewayJson(pathWithQuery, options) {
  const endpoint = resolveStoreEndpoint(options);
  const fetcher = (options == null ? void 0 : options.fetcher) ?? defaultStoreFetcher;
  const sessionToken = (options == null ? void 0 : options.sessionToken) !== void 0 ? options.sessionToken : await getActiveSessionToken();
  const headers = {
    Accept: "application/json",
    ...(options == null ? void 0 : options.headers) ?? {}
  };
  if (sessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  const response = await fetcher(`${endpoint}${pathWithQuery}`, {
    method: "GET",
    headers,
    credentials: (options == null ? void 0 : options.credentials) ?? "include"
  });
  const contentType = response.headers.get("content-type") ?? "";
  const isJsonResponse = contentType.includes("application/json");
  const responseBody = isJsonResponse ? await response.json() : await response.text();
  if (!response.ok) {
    const errorBody = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody) ? responseBody : null;
    throw new NdmStoreApiError(
      response.status,
      errorBody == null ? void 0 : errorBody.error,
      (errorBody == null ? void 0 : errorBody.message) ?? (typeof responseBody === "string" && responseBody.length > 0 ? responseBody : `NDM zone gateway request failed with status ${response.status}`),
      responseBody
    );
  }
  return responseBody;
}
async function lookupObject(request, options) {
  const query = [
    `scope=${encodeLookupQueryValue(request.scope)}`,
    `quick_hash=${encodeLookupQueryValue(request.quick_hash)}`
  ];
  if (request.inner_path) {
    query.push(`inner_path=${encodeLookupQueryValue(request.inner_path)}`);
  }
  const response = await getZoneGatewayJson(
    `/ndm/v1/objects/lookup?${query.join("&")}`,
    options
  );
  if (isChunkQuickHash(request.quick_hash)) {
    return response;
  }
  return response;
}
async function getObject$1(request, options) {
  return callStoreApi("get_object", request, options);
}
async function openObject$1(request, options) {
  return callStoreApi("open_object", request, options);
}
async function getDirChild$1(request, options) {
  return callStoreApi("get_dir_child", request, options);
}
async function isObjectStored$1(request, options) {
  return callStoreApi("is_object_stored", request, options);
}
async function isObjectExist$1(request, options) {
  return callStoreApi("is_object_exist", request, options);
}
async function queryObjectById$1(request, options) {
  return callStoreApi("query_object_by_id", request, options);
}
async function putObject$1(request, options) {
  return callStoreApi("put_object", request, options);
}
async function removeObject$1(request, options) {
  return callStoreApi("remove_object", request, options);
}
async function haveChunk$1(request, options) {
  return callStoreApi("have_chunk", request, options);
}
async function queryChunkState$1(request, options) {
  return callStoreApi("query_chunk_state", request, options);
}
async function removeChunk$1(request, options) {
  return callStoreApi("remove_chunk", request, options);
}
async function addChunkBySameAs$1(request, options) {
  return callStoreApi("add_chunk_by_same_as", request, options);
}
async function applyEdge$1(request, options) {
  return callStoreApi("apply_edge", request, options);
}
async function pin$1(request, options) {
  return callStoreApi("pin", request, options);
}
async function unpin$1(request, options) {
  return callStoreApi("unpin", request, options);
}
async function unpinOwner$1(request, options) {
  return callStoreApi("unpin_owner", request, options);
}
async function fsAcquire$1(request, options) {
  return callStoreApi("fs_acquire", request, options);
}
async function fsRelease$1(request, options) {
  return callStoreApi("fs_release", request, options);
}
async function fsReleaseInode$1(request, options) {
  return callStoreApi("fs_release_inode", request, options);
}
async function fsAnchorState$1(request, options) {
  return callStoreApi("fs_anchor_state", request, options);
}
async function forcedGcUntil$1(request, options) {
  return callStoreApi("forced_gc_until", request, options);
}
async function outboxCount$1(options) {
  return callStoreApi("outbox_count", {}, options);
}
async function debugDumpExpandState$1(request, options) {
  return callStoreApi("debug_dump_expand_state", request, options);
}
async function anchorState$1(request, options) {
  return callStoreApi("anchor_state", request, options);
}
async function materializeFile(file, chunkSize = DEFAULT_CHUNK_SIZE) {
  const fileSize = file.size;
  const chunks = [];
  if (fileSize <= chunkSize) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const hash = sha256Bytes(buf);
    const chunkId = ChunkId.fromMix256Result(buf.length, hash);
    const chunkIdStr = chunkId.toString();
    chunks.push({ chunkId: chunkIdStr, offset: 0, length: buf.length, uploaded: false });
    const fileObj2 = new FileObject(file.name, fileSize, chunkIdStr);
    const [objId2] = fileObj2.genObjId();
    return { objectId: objId2.toString(), chunks, fileObject: fileObj2.toJSON() };
  }
  const chunkList = new SimpleChunkList();
  let offset = 0;
  while (offset < fileSize) {
    const end = Math.min(offset + chunkSize, fileSize);
    const slice = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    const hash = sha256Bytes(slice);
    const chunkId = ChunkId.fromMix256Result(slice.length, hash);
    chunkList.appendChunk(chunkId);
    chunks.push({ chunkId: chunkId.toString(), offset, length: slice.length, uploaded: false });
    offset = end;
  }
  const [chunkListObjId] = chunkList.genObjId();
  const fileObj = new FileObject(file.name, fileSize, chunkListObjId.toString());
  const [objId] = fileObj.genObjId();
  return { objectId: objId.toString(), chunks, fileObject: fileObj.toJSON() };
}
async function materializeFileViaWorker(file, onHashProgress, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (!isHashWorkerAvailable()) {
    return materializeFile(file, chunkSize);
  }
  let hashResults;
  try {
    const session = hashFileInWorker(file, chunkSize);
    if (onHashProgress) {
      session.onProgress(onHashProgress);
    }
    const WORKER_TIMEOUT_MS = 5 * 60 * 1e3;
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("hash worker timeout")), WORKER_TIMEOUT_MS);
    });
    hashResults = await Promise.race([session.result, timeout]);
  } catch {
    return materializeFile(file, chunkSize);
  }
  const fileSize = file.size;
  const chunks = [];
  if (hashResults.length === 1) {
    const r = hashResults[0];
    const chunkId = ChunkId.fromMix256Result(r.length, r.hash);
    const chunkIdStr = chunkId.toString();
    chunks.push({ chunkId: chunkIdStr, offset: 0, length: r.length, uploaded: false });
    const fileObj2 = new FileObject(file.name, fileSize, chunkIdStr);
    const [objId2] = fileObj2.genObjId();
    return { objectId: objId2.toString(), chunks, fileObject: fileObj2.toJSON() };
  }
  const chunkList = new SimpleChunkList();
  for (const r of hashResults) {
    const chunkId = ChunkId.fromMix256Result(r.length, r.hash);
    chunkList.appendChunk(chunkId);
    chunks.push({ chunkId: chunkId.toString(), offset: r.offset, length: r.length, uploaded: false });
  }
  const [chunkListObjId] = chunkList.genObjId();
  const fileObj = new FileObject(file.name, fileSize, chunkListObjId.toString());
  const [objId] = fileObj.genObjId();
  return { objectId: objId.toString(), chunks, fileObject: fileObj.toJSON() };
}
function buildFileObjectFromContentId(name, size, contentId) {
  const fileObj = new FileObject(name, size, contentId);
  const [objId] = fileObj.genObjId();
  return {
    objectId: objId.toString(),
    fileObject: fileObj.toJSON()
  };
}
function resolveImportLookupEndpoint() {
  var _a;
  const activeOrigin = getActiveZoneGatewayOrigin();
  if (activeOrigin) {
    return normalizeEndpoint$1(activeOrigin);
  }
  if (typeof window !== "undefined" && ((_a = window.location) == null ? void 0 : _a.origin)) {
    return normalizeEndpoint$1(window.location.origin);
  }
  return void 0;
}
async function tryCalculateQcidFromFile(file) {
  const fileSize = file.size;
  if (fileSize < MIN_QCID_FILE_SIZE) {
    return null;
  }
  const beginBytes = new Uint8Array(await file.slice(0, QCID_HASH_PIECE_SIZE).arrayBuffer());
  const midOffset = Math.floor(fileSize / 2);
  const midBytes = new Uint8Array(
    await file.slice(midOffset, midOffset + QCID_HASH_PIECE_SIZE).arrayBuffer()
  );
  const combined = new Uint8Array(beginBytes.length + midBytes.length);
  combined.set(beginBytes, 0);
  combined.set(midBytes, beginBytes.length);
  const hash = sha256Bytes(combined);
  return ChunkId.fromMixHashResult(fileSize, hash, "qcid").toString();
}
async function calculateQcidFromFile(file) {
  const qcid = await tryCalculateQcidFromFile(file);
  if (!qcid) {
    throw new Error(`QCID requires file size >= ${MIN_QCID_FILE_SIZE} bytes`);
  }
  return qcid;
}
function extractLookupContentId(response, quickHash) {
  const body = response;
  if (typeof body.same_as === "string" && body.same_as.length > 0) {
    return body.same_as;
  }
  const directContentKeys = [
    "chunk_list_id",
    "chunklistid",
    "chunk_id",
    "chunkid",
    "content_id",
    "content"
  ];
  for (const key of directContentKeys) {
    const value = body[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  if (typeof body.object_id === "string" && body.object_id.length > 0 && body.object_id !== quickHash) {
    return body.object_id;
  }
  return void 0;
}
async function lookupFileByQcid(file) {
  const endpoint = resolveImportLookupEndpoint();
  if (!endpoint) {
    return null;
  }
  const qcid = await tryCalculateQcidFromFile(file);
  if (!qcid) {
    return null;
  }
  for (const scope of ["app", "global"]) {
    try {
      const response = await lookupObject(
        { scope, quick_hash: qcid },
        {
          endpoint,
          sessionToken: getActiveRuntimeType() === RuntimeType.Browser ? null : void 0
        }
      );
      const contentId = extractLookupContentId(response, qcid);
      if (!contentId) {
        continue;
      }
      return {
        ...buildFileObjectFromContentId(file.name, file.size, contentId),
        locality: "store"
      };
    } catch (error) {
      if (error instanceof NdmStoreApiError && error.status === 404) {
        continue;
      }
      return null;
    }
  }
  return null;
}
function buildDirTree(files, fileObjects) {
  const firstPath = files[0].webkitRelativePath;
  const rootName = firstPath ? firstPath.split("/")[0] : "directory";
  const root = {
    kind: "dir",
    objectId: "",
    // will be computed later
    name: rootName,
    children: []
  };
  const dirMap = /* @__PURE__ */ new Map();
  dirMap.set("", root);
  for (const fileObj of fileObjects) {
    const relPath = fileObj.relativePath ?? fileObj.name;
    const parts = relPath.split("/");
    const pathParts = parts.length > 1 ? parts.slice(1) : parts;
    let currentDir = root;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const dirName = pathParts[i];
      const dirPath = pathParts.slice(0, i + 1).join("/");
      let dir = dirMap.get(dirPath);
      if (!dir) {
        dir = {
          kind: "dir",
          objectId: "",
          name: dirName,
          relativePath: dirPath,
          children: []
        };
        dirMap.set(dirPath, dir);
        currentDir.children.push(dir);
      }
      currentDir = dir;
    }
    currentDir.children.push(fileObj);
  }
  computeDirObjectIds(root);
  return root;
}
function computeDirObjectIds(dir) {
  const ndnDir = new DirObject(dir.name);
  if (dir.children) {
    for (const child of dir.children) {
      if (child.kind === "file") {
        if (!child._ndnFileObject) {
          throw new NdmError("UPLOAD_FAILED", `Missing NDN FileObject for ${child.name}`);
        }
        ndnDir.addFile(child.name, child._ndnFileObject, child.size);
      } else {
        const childState = computeDirObjectIds(child);
        ndnDir.addDirectory(child.name, ObjId.fromString(childState.objectId), childState.totalSize);
      }
    }
  }
  const [objId] = ndnDir.genObjId();
  dir.objectId = objId.toString();
  return {
    objectId: dir.objectId,
    totalSize: ndnDir.total_size,
    fileCount: ndnDir.file_count,
    fileSize: ndnDir.file_size
  };
}
function shouldGenerateThumbnail(file, options) {
  if (!options || !options.enabled)
    return false;
  if (!options.forTypes || options.forTypes.length === 0) {
    return file.type.startsWith("image/");
  }
  for (const filter of options.forTypes) {
    if (filter.endsWith("/*")) {
      const prefix = filter.slice(0, -1);
      if (file.type.startsWith(prefix))
        return true;
    } else if (filter.startsWith(".")) {
      if (file.name.toLowerCase().endsWith(filter.toLowerCase()))
        return true;
    } else {
      if (file.type === filter)
        return true;
    }
  }
  return false;
}
async function generateThumbnail(file, options) {
  const maxWidth = options.maxWidth ?? 256;
  const maxHeight = options.maxHeight ?? 256;
  try {
    if (file.type.startsWith("image/")) {
      return await generateImageThumbnail(file, maxWidth, maxHeight);
    }
    return { available: false, errorCode: "UNSUPPORTED_TYPE" };
  } catch {
    return { available: false, errorCode: "THUMBNAIL_GENERATION_FAILED" };
  }
}
function generateImageThumbnail(file, maxWidth, maxHeight) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxWidth || h > maxHeight) {
        const scale = Math.min(maxWidth / w, maxHeight / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const thumbUrl = canvas.toDataURL("image/jpeg", 0.8);
      URL.revokeObjectURL(url);
      resolve({ available: true, url: thumbUrl, width: w, height: h, mimeType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ available: false, errorCode: "THUMBNAIL_GENERATION_FAILED" });
    };
    img.src = url;
  });
}
function collectSummary(items) {
  let totalFiles = 0;
  let totalDirs = 0;
  let totalBytes = 0;
  function walk(list) {
    for (const item of list) {
      if (item.kind === "file") {
        totalFiles++;
        totalBytes += item.size;
      } else {
        totalDirs++;
        if (item.children)
          walk(item.children);
      }
    }
  }
  walk(items);
  return { totalObjects: totalFiles + totalDirs, totalFiles, totalDirs, totalBytes };
}
async function pickupAndImport(options) {
  var _a;
  const caps = currentProvider.getCapabilities();
  if (options.mode === "single_dir" && !caps.canPickDirectory) {
    throw new NdmError("DIRECTORY_NOT_SUPPORTED", "Current runtime does not support directory selection");
  }
  if (options.mode === "mixed" && !caps.canPickMixed) {
    throw new NdmError("MODE_NOT_SUPPORTED_IN_RUNTIME", "Current runtime does not support mixed file/directory selection");
  }
  const files = await currentProvider.pickFiles(options);
  if (files.length === 0) {
    throw new NdmError("USER_CANCELLED", "No files selected");
  }
  const fileObjects = [];
  const objectStates = /* @__PURE__ */ new Map();
  let allFilesAlreadyStored = true;
  const onProgress = options.onProgress;
  const fileCount = files.length;
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const relativePath = file.webkitRelativePath || void 0;
    if (onProgress) {
      onProgress({ phase: "qcid_lookup", fileIndex: fi, fileCount, fileName: file.name, fileTotalBytes: file.size });
    }
    const lookupHit = await lookupFileByQcid(file);
    let materialized = null;
    if (!lookupHit) {
      if (onProgress) {
        onProgress({ phase: "materializing", fileIndex: fi, fileCount, fileName: file.name, bytesProcessed: 0, fileTotalBytes: file.size });
      }
      materialized = await materializeFileViaWorker(
        file,
        onProgress ? (bytesHashed) => {
          onProgress({ phase: "materializing", fileIndex: fi, fileCount, fileName: file.name, bytesProcessed: bytesHashed, fileTotalBytes: file.size });
        } : void 0
      );
    }
    const objectId = (lookupHit == null ? void 0 : lookupHit.objectId) ?? materialized.objectId;
    const fileObject = (lookupHit == null ? void 0 : lookupHit.fileObject) ?? materialized.fileObject;
    const chunks = lookupHit ? [] : materialized.chunks;
    const imported = {
      kind: "file",
      objectId,
      name: file.name,
      size: file.size,
      mimeType: file.type || void 0,
      relativePath,
      locality: (lookupHit == null ? void 0 : lookupHit.locality) ?? "local_only",
      _file: file,
      _ndnFileObject: fileObject
    };
    if (shouldGenerateThumbnail(file, options.thumbnails)) {
      if (onProgress) {
        onProgress({ phase: "thumbnail", fileIndex: fi, fileCount, fileName: file.name, fileTotalBytes: file.size });
      }
      const eager = ((_a = options.thumbnails) == null ? void 0 : _a.eager) !== false;
      if (eager) {
        imported.thumbnail = await generateThumbnail(file, options.thumbnails);
      } else {
        imported.thumbnail = { available: false };
        generateThumbnail(file, options.thumbnails).then((result) => {
          imported.thumbnail = result;
        });
      }
    }
    fileObjects.push(imported);
    if (!lookupHit) {
      allFilesAlreadyStored = false;
    }
    objectStates.set(objectId, {
      objectId,
      name: file.name,
      size: file.size,
      file,
      uploadedBytes: lookupHit ? file.size : 0,
      state: lookupHit ? "completed" : "pending",
      chunks
    });
  }
  let items;
  let selection;
  if (options.mode === "single_dir") {
    const dirObj = buildDirTree(files, fileObjects);
    items = [dirObj];
    selection = dirObj;
  } else {
    items = fileObjects;
    if (options.mode === "single_file") {
      selection = fileObjects[0];
    } else {
      selection = fileObjects;
    }
  }
  const summary = collectSummary(items);
  const sessionId = generateSessionId();
  let materializationStatus = "ok";
  if (allFilesAlreadyStored || caps.canUseNDMStore) {
    materializationStatus = "all_in_store";
  } else if (caps.canUseNDMCache) {
    materializationStatus = "on_cache";
  }
  const uploadStatus = materializationStatus === "all_in_store" ? "not_required" : "not_started";
  const session = {
    sessionId,
    items,
    materializationStatus,
    uploadStatus,
    summary,
    objectStates
  };
  sessionRegistry.set(sessionId, session);
  const snapshot = {
    sessionId,
    selection,
    items,
    materializationStatus,
    uploadStatus,
    summary
  };
  if (options.autoStartUpload && uploadStatus === "not_started") {
    startUpload(sessionId).catch(() => {
    });
    snapshot.uploadStatus = "uploading";
  }
  return snapshot;
}
async function getImportSessionStatus(sessionId) {
  const session = sessionRegistry.get(sessionId);
  if (!session) {
    throw new NdmError("SESSION_NOT_FOUND", `Session ${sessionId} not found`);
  }
  const perObjectProgress = {};
  let uploadedBytes = 0;
  let uploadedObjects = 0;
  for (const [id, state] of session.objectStates) {
    perObjectProgress[id] = {
      objectId: state.objectId,
      uploadedBytes: state.uploadedBytes,
      totalBytes: state.size,
      state: state.state
    };
    uploadedBytes += state.uploadedBytes;
    if (state.state === "completed")
      uploadedObjects++;
  }
  return {
    sessionId,
    materializationStatus: session.materializationStatus,
    uploadStatus: session.uploadStatus,
    summary: session.summary,
    progress: {
      uploadedBytes,
      uploadedObjects,
      totalBytes: session.summary.totalBytes,
      totalObjects: session.summary.totalFiles
    },
    perObjectProgress
  };
}
async function getUploadProgress(sessionId) {
  const status = await getImportSessionStatus(sessionId);
  const result = {
    sessionId,
    uploadStatus: status.uploadStatus,
    totalBytes: status.progress.totalBytes,
    uploadedBytes: status.progress.uploadedBytes,
    totalObjects: status.progress.totalObjects,
    uploadedObjects: status.progress.uploadedObjects,
    perObjectProgress: status.perObjectProgress
  };
  const session = sessionRegistry.get(sessionId);
  if (session.uploadStartTime && status.uploadStatus === "uploading") {
    result.elapsedMs = Date.now() - session.uploadStartTime;
    if (result.uploadedBytes > 0 && result.elapsedMs > 0) {
      result.speedBps = Math.round(result.uploadedBytes * 1e3 / result.elapsedMs);
      const remaining = result.totalBytes - result.uploadedBytes;
      result.estimatedRemainingMs = Math.round(remaining * 1e3 / result.speedBps);
    }
  }
  return result;
}
async function uploadChunkViaTus(endpoint, file, chunkInfo, chunkIndex, appId, fileHash, onProgress, signal) {
  const slice = file.slice(chunkInfo.offset, chunkInfo.offset + chunkInfo.length);
  const chunkData = new Uint8Array(await slice.arrayBuffer());
  const logicalPath = `${appId}/${chunkInfo.chunkId}`;
  let tusModule;
  try {
    tusModule = await import("./tus_client-9c79e84d.mjs");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new NdmError("UPLOAD_FAILED", `Failed to load tus-js-client: ${message}`);
  }
  return new Promise((resolve, reject) => {
    if (signal == null ? void 0 : signal.aborted) {
      reject(new NdmError("UPLOAD_FAILED", "Upload aborted"));
      return;
    }
    const blob = new Blob([chunkData]);
    const upload = new tusModule.Upload(blob, {
      endpoint: `${endpoint}/ndm/v1/uploads`,
      chunkSize: chunkData.length,
      retryDelays: [0, 1e3, 3e3, 5e3],
      storeFingerprintForResuming: false,
      metadata: {
        app_id: appId,
        logical_path: logicalPath,
        file_name: file.name,
        file_size: String(file.size),
        file_hash: fileHash,
        chunk_index: String(chunkIndex),
        chunk_hash: chunkInfo.chunkId,
        mime_type: file.type || "application/octet-stream"
      },
      onProgress: (bytesUploaded) => {
        onProgress(bytesUploaded);
      },
      onSuccess: () => {
        onProgress(chunkData.length);
        resolve(chunkInfo.chunkId);
      },
      onError: (error) => {
        reject(new NdmError("UPLOAD_FAILED", error.message));
      }
    });
    if (signal) {
      signal.addEventListener("abort", () => {
        upload.abort(true);
        reject(new NdmError("UPLOAD_FAILED", "Upload aborted"));
      });
    }
    upload.start();
  });
}
async function startUpload(sessionId, options) {
  const session = sessionRegistry.get(sessionId);
  if (!session) {
    throw new NdmError("SESSION_NOT_FOUND", `Session ${sessionId} not found`);
  }
  if (session.uploadStatus === "completed" || session.uploadStatus === "not_required") {
    return getImportSessionStatus(sessionId);
  }
  if (session.uploadStatus === "uploading") {
    return getImportSessionStatus(sessionId);
  }
  if (session.materializationStatus === "all_in_store") {
    session.uploadStatus = "not_required";
    return getImportSessionStatus(sessionId);
  }
  session.uploadStatus = "uploading";
  session.uploadStartTime = Date.now();
  session.abortController = new AbortController();
  const concurrency = (options == null ? void 0 : options.concurrency) ?? 3;
  let endpoint;
  if (options == null ? void 0 : options.endpoint) {
    endpoint = options.endpoint.replace(/\/+$/, "");
  } else {
    endpoint = typeof window !== "undefined" ? window.location.origin : "";
  }
  doUpload(session, endpoint, concurrency).catch(() => {
  });
  return getImportSessionStatus(sessionId);
}
async function doUpload(session, endpoint, concurrency) {
  const states = Array.from(session.objectStates.values()).filter((s) => s.state !== "completed");
  let running = 0;
  let idx = 0;
  let hasError = false;
  await new Promise((resolve, reject) => {
    function next() {
      if (hasError)
        return;
      if (idx >= states.length && running === 0) {
        const allCompleted = Array.from(session.objectStates.values()).every((s) => s.state === "completed");
        session.uploadStatus = allCompleted ? "completed" : "failed";
        resolve();
        return;
      }
      while (running < concurrency && idx < states.length) {
        const state = states[idx++];
        running++;
        uploadSingleObject(session, endpoint, state).then(() => {
          running--;
          next();
        }).catch(() => {
          running--;
          if (!hasError) {
            hasError = true;
            session.uploadStatus = "failed";
            reject(new NdmError("UPLOAD_FAILED", `Upload of ${state.name} failed`));
          }
        });
      }
    }
    next();
  });
}
async function uploadSingleObject(session, endpoint, state) {
  var _a;
  state.state = "uploading";
  for (const [chunkIndex, chunk] of state.chunks.entries()) {
    if (chunk.uploaded)
      continue;
    await uploadChunkViaTus(
      endpoint,
      state.file,
      chunk,
      chunkIndex,
      "default",
      state.objectId,
      (uploaded) => {
        const prevChunkBytes = state.chunks.filter((c) => c !== chunk && c.uploaded).reduce((sum, c) => sum + c.length, 0);
        state.uploadedBytes = prevChunkBytes + uploaded;
      },
      (_a = session.abortController) == null ? void 0 : _a.signal
    );
    chunk.uploaded = true;
  }
  state.uploadedBytes = state.size;
  state.state = "completed";
}
const ndm_client = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  NdmError,
  NdmStoreApiError,
  addChunkBySameAs: addChunkBySameAs$1,
  anchorState: anchorState$1,
  applyEdge: applyEdge$1,
  calculateQcidFromFile,
  debugDumpExpandState: debugDumpExpandState$1,
  forcedGcUntil: forcedGcUntil$1,
  fsAcquire: fsAcquire$1,
  fsAnchorState: fsAnchorState$1,
  fsRelease: fsRelease$1,
  fsReleaseInode: fsReleaseInode$1,
  getDirChild: getDirChild$1,
  getImportProvider,
  getImportSessionStatus,
  getObject: getObject$1,
  getUploadProgress,
  haveChunk: haveChunk$1,
  isObjectExist: isObjectExist$1,
  isObjectStored: isObjectStored$1,
  lookupObject,
  openObject: openObject$1,
  outboxCount: outboxCount$1,
  pickupAndImport,
  pin: pin$1,
  putObject: putObject$1,
  queryChunkState: queryChunkState$1,
  queryObjectById: queryObjectById$1,
  removeChunk: removeChunk$1,
  removeObject: removeObject$1,
  setImportProvider,
  startUpload,
  unpin: unpin$1,
  unpinOwner: unpinOwner$1
}, Symbol.toStringTag, { value: "Module" }));
const NDM_PROXY_V1_PATH = "/ndm/proxy/v1";
class NdmProxyApiError extends Error {
  constructor(status, errorCode, message, responseBody) {
    super(message ?? `NDM proxy request failed with status ${status}`);
    this.name = "NdmProxyApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.responseBody = responseBody;
  }
}
class NdmProxyError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "NdmProxyError";
    this.code = code;
  }
}
function defaultProxyFetcher(input, init) {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch(input, init);
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch(input, init);
  }
  throw new Error("fetch is not available in this runtime");
}
function normalizeEndpoint(endpoint) {
  return endpoint.replace(/\/+$/, "");
}
function ensureProxyApiSupportedRuntime() {
  const runtimeType = getActiveRuntimeType();
  if (runtimeType === RuntimeType.Browser || runtimeType === RuntimeType.AppRuntime) {
    throw new NdmProxyError(
      "PROXY_API_NOT_SUPPORTED_IN_RUNTIME",
      "NDM proxy APIs are not available in Browser/AppRuntime; use ndm_client for browser import/upload flows"
    );
  }
}
function resolveProxyEndpoint(options) {
  if (options == null ? void 0 : options.endpoint) {
    return normalizeEndpoint(options.endpoint);
  }
  const activeOrigin = getActiveZoneGatewayOrigin();
  if (activeOrigin) {
    return normalizeEndpoint(activeOrigin);
  }
  throw new NdmProxyError(
    "PROXY_API_ENDPOINT_REQUIRED",
    "NDM proxy endpoint is unknown; pass options.endpoint or call initBuckyOS first"
  );
}
async function buildHeaders(options, baseHeaders) {
  const sessionToken = (options == null ? void 0 : options.sessionToken) !== void 0 ? options.sessionToken : await getActiveSessionToken();
  const headers = {
    ...baseHeaders,
    ...(options == null ? void 0 : options.headers) ?? {}
  };
  if (sessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  return headers;
}
async function parseErrorResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const isJsonResponse = contentType.includes("application/json");
  const responseBody = isJsonResponse ? await response.json() : await response.text();
  const errorBody = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody) ? responseBody : null;
  throw new NdmProxyApiError(
    response.status,
    errorBody == null ? void 0 : errorBody.error,
    (errorBody == null ? void 0 : errorBody.message) ?? (typeof responseBody === "string" && responseBody.length > 0 ? responseBody : `NDM proxy request failed with status ${response.status}`),
    responseBody
  );
}
async function callProxyRpc(methodName, requestBody, options) {
  var _a;
  ensureProxyApiSupportedRuntime();
  const endpoint = resolveProxyEndpoint(options);
  const fetcher = (options == null ? void 0 : options.fetcher) ?? defaultProxyFetcher;
  const headers = await buildHeaders(options, {
    Accept: "application/json",
    "Content-Type": "application/json"
  });
  const response = await fetcher(`${endpoint}${NDM_PROXY_V1_PATH}/rpc/${methodName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    credentials: (options == null ? void 0 : options.credentials) ?? "include"
  });
  if (!response.ok) {
    return parseErrorResponse(response);
  }
  if (response.status === 204) {
    await ((_a = response.body) == null ? void 0 : _a.cancel());
    return void 0;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new NdmProxyApiError(
      response.status,
      "invalid_data",
      text.length > 0 ? text : "NDM proxy JSON RPC returned a non-JSON response",
      text
    );
  }
  return await response.json();
}
function parseNullableNumberHeader(headers, name) {
  const value = headers.get(name);
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
async function postProxyRead(path, requestBody, options) {
  ensureProxyApiSupportedRuntime();
  const endpoint = resolveProxyEndpoint(options);
  const fetcher = (options == null ? void 0 : options.fetcher) ?? defaultProxyFetcher;
  const headers = await buildHeaders(options, {
    Accept: "application/octet-stream",
    "Content-Type": "application/json"
  });
  const response = await fetcher(`${endpoint}${NDM_PROXY_V1_PATH}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    credentials: (options == null ? void 0 : options.credentials) ?? "include"
  });
  if (!response.ok) {
    return parseErrorResponse(response);
  }
  return {
    response,
    body: response.body,
    totalSize: parseNullableNumberHeader(response.headers, "NDM-Total-Size"),
    resolvedObjectId: response.headers.get("NDM-Resolved-Object-ID") ?? void 0,
    readerKind: response.headers.get("NDM-Reader-Kind") ?? void 0,
    contentLength: parseNullableNumberHeader(response.headers, "Content-Length"),
    offset: parseNullableNumberHeader(response.headers, "NDM-Offset")
  };
}
async function readResponseBytes(result) {
  const buffer = await result.response.arrayBuffer();
  return new Uint8Array(buffer);
}
function bodyLength(body) {
  if (body instanceof Uint8Array) {
    return body.byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return body.size;
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  return null;
}
function chunkWritePath(chunkId) {
  return `${NDM_PROXY_V1_PATH}/write/chunk/${encodeURIComponent(chunkId)}`;
}
class NdmProxyRpcClient {
  constructor(options) {
    this.options = options;
  }
  getObject(request, options) {
    return getObject(request, { ...this.options, ...options });
  }
  openObject(request, options) {
    return openObject(request, { ...this.options, ...options });
  }
  getDirChild(request, options) {
    return getDirChild(request, { ...this.options, ...options });
  }
  isObjectStored(request, options) {
    return isObjectStored(request, { ...this.options, ...options });
  }
  isObjectExist(request, options) {
    return isObjectExist(request, { ...this.options, ...options });
  }
  queryObjectById(request, options) {
    return queryObjectById(request, { ...this.options, ...options });
  }
  putObject(request, options) {
    return putObject(request, { ...this.options, ...options });
  }
  removeObject(request, options) {
    return removeObject(request, { ...this.options, ...options });
  }
  haveChunk(request, options) {
    return haveChunk(request, { ...this.options, ...options });
  }
  queryChunkState(request, options) {
    return queryChunkState(request, { ...this.options, ...options });
  }
  removeChunk(request, options) {
    return removeChunk(request, { ...this.options, ...options });
  }
  addChunkBySameAs(request, options) {
    return addChunkBySameAs(request, { ...this.options, ...options });
  }
  applyEdge(request, options) {
    return applyEdge(request, { ...this.options, ...options });
  }
  pin(request, options) {
    return pin(request, { ...this.options, ...options });
  }
  unpin(request, options) {
    return unpin(request, { ...this.options, ...options });
  }
  unpinOwner(request, options) {
    return unpinOwner(request, { ...this.options, ...options });
  }
  fsAcquire(request, options) {
    return fsAcquire(request, { ...this.options, ...options });
  }
  fsRelease(request, options) {
    return fsRelease(request, { ...this.options, ...options });
  }
  fsReleaseInode(request, options) {
    return fsReleaseInode(request, { ...this.options, ...options });
  }
  fsAnchorState(request, options) {
    return fsAnchorState(request, { ...this.options, ...options });
  }
  forcedGcUntil(request, options) {
    return forcedGcUntil(request, { ...this.options, ...options });
  }
  outboxCount(options) {
    return outboxCount({ ...this.options, ...options });
  }
  debugDumpExpandState(request, options) {
    return debugDumpExpandState(request, { ...this.options, ...options });
  }
  anchorState(request, options) {
    return anchorState(request, { ...this.options, ...options });
  }
}
class NdmProxyReaderClient {
  constructor(options) {
    this.options = options;
  }
  openChunkReader(request, options) {
    return openChunkReader(request, { ...this.options, ...options });
  }
  getChunkData(request, options) {
    return getChunkData(request, { ...this.options, ...options });
  }
  getChunkPiece(request, options) {
    return getChunkPiece(request, { ...this.options, ...options });
  }
  openChunkListReader(request, options) {
    return openChunkListReader(request, { ...this.options, ...options });
  }
  openReader(request, options) {
    return openReader(request, { ...this.options, ...options });
  }
}
class NdmProxyWriterClient {
  constructor(options) {
    this.options = options;
  }
  putChunkByReader(chunkId, body, options) {
    return putChunkByReader(chunkId, body, { ...this.options, ...options });
  }
  putChunk(chunkId, data, options) {
    return putChunk(chunkId, data, { ...this.options, ...options });
  }
}
class NdmProxyClient {
  constructor(options) {
    this.options = options;
    this.rpc = new NdmProxyRpcClient(options);
    this.reader = new NdmProxyReaderClient(options);
    this.writer = new NdmProxyWriterClient(options);
  }
  getObject(request, options) {
    return this.rpc.getObject(request, options);
  }
  openObject(request, options) {
    return this.rpc.openObject(request, options);
  }
  getDirChild(request, options) {
    return this.rpc.getDirChild(request, options);
  }
  isObjectStored(request, options) {
    return this.rpc.isObjectStored(request, options);
  }
  isObjectExist(request, options) {
    return this.rpc.isObjectExist(request, options);
  }
  queryObjectById(request, options) {
    return this.rpc.queryObjectById(request, options);
  }
  putObject(request, options) {
    return this.rpc.putObject(request, options);
  }
  removeObject(request, options) {
    return this.rpc.removeObject(request, options);
  }
  haveChunk(request, options) {
    return this.rpc.haveChunk(request, options);
  }
  queryChunkState(request, options) {
    return this.rpc.queryChunkState(request, options);
  }
  removeChunk(request, options) {
    return this.rpc.removeChunk(request, options);
  }
  addChunkBySameAs(request, options) {
    return this.rpc.addChunkBySameAs(request, options);
  }
  applyEdge(request, options) {
    return this.rpc.applyEdge(request, options);
  }
  pin(request, options) {
    return this.rpc.pin(request, options);
  }
  unpin(request, options) {
    return this.rpc.unpin(request, options);
  }
  unpinOwner(request, options) {
    return this.rpc.unpinOwner(request, options);
  }
  fsAcquire(request, options) {
    return this.rpc.fsAcquire(request, options);
  }
  fsRelease(request, options) {
    return this.rpc.fsRelease(request, options);
  }
  fsReleaseInode(request, options) {
    return this.rpc.fsReleaseInode(request, options);
  }
  fsAnchorState(request, options) {
    return this.rpc.fsAnchorState(request, options);
  }
  forcedGcUntil(request, options) {
    return this.rpc.forcedGcUntil(request, options);
  }
  outboxCount(options) {
    return this.rpc.outboxCount(options);
  }
  debugDumpExpandState(request, options) {
    return this.rpc.debugDumpExpandState(request, options);
  }
  anchorState(request, options) {
    return this.rpc.anchorState(request, options);
  }
  openChunkReader(request, options) {
    return this.reader.openChunkReader(request, options);
  }
  getChunkData(request, options) {
    return this.reader.getChunkData(request, options);
  }
  getChunkPiece(request, options) {
    return this.reader.getChunkPiece(request, options);
  }
  openChunkListReader(request, options) {
    return this.reader.openChunkListReader(request, options);
  }
  openReader(request, options) {
    return this.reader.openReader(request, options);
  }
  putChunkByReader(chunkId, body, options) {
    return this.writer.putChunkByReader(chunkId, body, options);
  }
  putChunk(chunkId, data, options) {
    return this.writer.putChunk(chunkId, data, options);
  }
  withOptions(options) {
    return new NdmProxyClient({ ...this.options, ...options });
  }
}
function createNdmProxyClient(options) {
  return new NdmProxyClient(options);
}
async function getObject(request, options) {
  return callProxyRpc("get_object", request, options);
}
async function openObject(request, options) {
  return callProxyRpc("open_object", request, options);
}
async function getDirChild(request, options) {
  return callProxyRpc("get_dir_child", request, options);
}
async function isObjectStored(request, options) {
  return callProxyRpc("is_object_stored", request, options);
}
async function isObjectExist(request, options) {
  return callProxyRpc("is_object_exist", request, options);
}
async function queryObjectById(request, options) {
  return callProxyRpc("query_object_by_id", request, options);
}
async function putObject(request, options) {
  return callProxyRpc("put_object", request, options);
}
async function removeObject(request, options) {
  return callProxyRpc("remove_object", request, options);
}
async function haveChunk(request, options) {
  return callProxyRpc("have_chunk", request, options);
}
async function queryChunkState(request, options) {
  return callProxyRpc("query_chunk_state", request, options);
}
async function removeChunk(request, options) {
  return callProxyRpc("remove_chunk", request, options);
}
async function addChunkBySameAs(request, options) {
  return callProxyRpc("add_chunk_by_same_as", request, options);
}
async function applyEdge(request, options) {
  return callProxyRpc("apply_edge", request, options);
}
async function pin(request, options) {
  return callProxyRpc("pin", request, options);
}
async function unpin(request, options) {
  return callProxyRpc("unpin", request, options);
}
async function unpinOwner(request, options) {
  return callProxyRpc("unpin_owner", request, options);
}
async function fsAcquire(request, options) {
  return callProxyRpc("fs_acquire", request, options);
}
async function fsRelease(request, options) {
  return callProxyRpc("fs_release", request, options);
}
async function fsReleaseInode(request, options) {
  return callProxyRpc("fs_release_inode", request, options);
}
async function fsAnchorState(request, options) {
  return callProxyRpc("fs_anchor_state", request, options);
}
async function forcedGcUntil(request, options) {
  return callProxyRpc("forced_gc_until", request, options);
}
async function outboxCount(options) {
  return callProxyRpc("outbox_count", {}, options);
}
async function debugDumpExpandState(request, options) {
  return callProxyRpc("debug_dump_expand_state", request, options);
}
async function anchorState(request, options) {
  return callProxyRpc("anchor_state", request, options);
}
async function openChunkReader(request, options) {
  return postProxyRead("/read/chunk/open", request, options);
}
async function getChunkData(request, options) {
  return readResponseBytes(await postProxyRead("/read/chunk/data", request, options));
}
async function getChunkPiece(request, options) {
  return readResponseBytes(await postProxyRead("/read/chunk/piece", request, options));
}
async function openChunkListReader(request, options) {
  return postProxyRead("/read/chunklist/open", request, options);
}
async function openReader(request, options) {
  return postProxyRead("/read/object/open", request, options);
}
async function putChunkByReader(chunkId, body, options) {
  var _a;
  ensureProxyApiSupportedRuntime();
  const endpoint = resolveProxyEndpoint(options);
  const fetcher = (options == null ? void 0 : options.fetcher) ?? defaultProxyFetcher;
  const inferredSize = bodyLength(body);
  const chunkSize = (options == null ? void 0 : options.chunkSize) ?? inferredSize;
  if (chunkSize === null) {
    throw new NdmProxyError(
      "PROXY_API_CHUNK_SIZE_REQUIRED",
      "chunkSize is required when the request body length cannot be inferred"
    );
  }
  const headers = await buildHeaders(options, {
    Accept: "application/json",
    "Content-Type": "application/octet-stream",
    "Content-Length": String(chunkSize),
    "NDM-Chunk-Size": String(chunkSize)
  });
  const response = await fetcher(`${endpoint}${chunkWritePath(chunkId)}`, {
    method: "PUT",
    headers,
    body,
    credentials: (options == null ? void 0 : options.credentials) ?? "include"
  });
  if (!response.ok) {
    return parseErrorResponse(response);
  }
  await ((_a = response.body) == null ? void 0 : _a.cancel());
  return {
    chunkSize: parseNullableNumberHeader(response.headers, "NDM-Chunk-Size"),
    outcome: response.headers.get("NDM-Chunk-Write-Outcome") ?? void 0,
    chunkObjectId: response.headers.get("NDM-Chunk-Object-ID") ?? void 0
  };
}
async function putChunk(chunkId, data, options) {
  return putChunkByReader(chunkId, data, {
    ...options,
    chunkSize: (options == null ? void 0 : options.chunkSize) ?? data.byteLength
  });
}
const ndm_proxy = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  NDM_PROXY_V1_PATH,
  NdmProxyApiError,
  NdmProxyClient,
  NdmProxyError,
  NdmProxyReaderClient,
  NdmProxyRpcClient,
  NdmProxyWriterClient,
  addChunkBySameAs,
  anchorState,
  applyEdge,
  createNdmProxyClient,
  debugDumpExpandState,
  forcedGcUntil,
  fsAcquire,
  fsAnchorState,
  fsRelease,
  fsReleaseInode,
  getChunkData,
  getChunkPiece,
  getDirChild,
  getObject,
  haveChunk,
  isObjectExist,
  isObjectStored,
  openChunkListReader,
  openChunkReader,
  openObject,
  openReader,
  outboxCount,
  pin,
  putChunk,
  putChunkByReader,
  putObject,
  queryChunkState,
  queryObjectById,
  removeChunk,
  removeObject,
  unpin,
  unpinOwner
}, Symbol.toStringTag, { value: "Module" }));
export {
  KEventClient as $,
  AICC_SERVICE_NAME as A,
  BS_SERVICE_VERIFY_HUB as B,
  AICC_SERVICE_SERVICE_NAME as C,
  AICC_SERVICE_SERVICE_PORT as D,
  AICC_AI_METHODS as E,
  AICC_CONTROL_METHODS as F,
  AICC_FEATURES as G,
  isAiccAiMethod as H,
  aiccTextMessage as I,
  aiccMessageTextContent as J,
  aiccMessageFirstText as K,
  aiccResponseTextContent as L,
  MsgQueueClient as M,
  aiccResponseToolCalls as N,
  aiccResponseArtifacts as O,
  aiccRenderMessageForDebug as P,
  aiccEstimateMessageTextLen as Q,
  RuntimeType as R,
  SystemConfigClient as S,
  TaskManagerClient as T,
  validateAiccMessage as U,
  VerifyHubClient as V,
  WEB3_BRIDGE_HOST as W,
  validateAiccMessages as X,
  validateAiccResponse as Y,
  AiccClient as Z,
  KEventReader as _,
  ndm_proxy as a,
  isW3CDIDDocumentBase as a0,
  isBuckyOSOwnerConfigDocument as a1,
  isUserDocument as a2,
  isBuckyOSDeviceMiniDocument as a3,
  isBuckyOSZoneBootConfig as a4,
  isBuckyOSNodeIdentityConfig as a5,
  isBuckyOSDeviceDocument as a6,
  isBuckyOSAgentDocument as a7,
  isBuckyOSZoneDocument as a8,
  isDIDDocumentBase as a9,
  isOwnerConfigDocument as aa,
  isDeviceMiniConfig as ab,
  isDeviceDocument as ac,
  isAgentDocument as ad,
  isZoneDocument as ae,
  parseW3CDIDDocumentBase as af,
  parseBuckyOSOwnerConfigDocument as ag,
  parseOwnerConfigDocument as ah,
  parseBuckyOSDeviceMiniDocument as ai,
  parseDeviceMiniConfig as aj,
  parseBuckyOSDIDDocument as ak,
  getDidMethod as al,
  getDidIdentifier as am,
  BS_SERVICE_TASK_MANAGER as b,
  createSDKModule as c,
  getActiveZoneGatewayOrigin as d,
  getActiveSessionToken as e,
  BuckyOSSDK as f,
  getActiveRuntimeType as g,
  hashPassword as h,
  MsgCenterClient as i,
  RepoClient as j,
  WORKFLOW_SERVICE_NAME as k,
  WorkflowStepType as l,
  WorkflowOutputMode as m,
  ndm_client as n,
  WorkflowJoinMode as o,
  parseSessionTokenClaims as p,
  WorkflowRetryFallback as q,
  WorkflowDefinitionStatus as r,
  WorkflowRunStatus as s,
  WorkflowNodeRunState as t,
  WorkflowHumanActionKind as u,
  WorkflowScheduledTaskStatus as v,
  WorkflowScheduledTaskMisfirePolicy as w,
  WorkflowScheduledTaskFireStatus as x,
  WorkflowClient as y,
  AICC_SERVICE_UNIQUE_ID as z
};
//# sourceMappingURL=ndm_proxy-358fc819.mjs.map
