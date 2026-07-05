import { c as createSDKModule } from "./ndm_proxy-d02cc5bb.mjs";
import { E, F, G, A, C, D, z, Z, b, B, f, $, _, i, M, j, R, S, T, V, W, k, y, r, u, o, t, m, q, s, x, w, v, l, Q, K, J, P, O, L, N, I, g, e, d, h, H, n, a, p, U, X, Y } from "./ndm_proxy-d02cc5bb.mjs";
import { b as b2, D as D2, N as N2, t as t2, s as s2, j as j2, l as l2, h as h2, d as d2, g as g2, f as f2, c, e as e2, m as m2, k as k2, i as i2, n as n2, a as a2, r as r2, q as q2, o as o2, p as p2 } from "./ndn_types-7ce47e32.mjs";
const sdkModule = createSDKModule("browser");
const buckyos = sdkModule.buckyos;
const initBuckyOS = sdkModule.initBuckyOS;
const getBuckyOSConfig = sdkModule.getBuckyOSConfig;
const getRuntimeType = sdkModule.getRuntimeType;
const getAppId = sdkModule.getAppId;
const getKEventClient = sdkModule.getKEventClient;
const createEventReader = sdkModule.createEventReader;
const create_event_reader = sdkModule.create_event_reader;
const subscribeKEvent = sdkModule.subscribeKEvent;
const attachEvent = sdkModule.attachEvent;
const removeEvent = sdkModule.removeEvent;
const getAccountInfo = sdkModule.getAccountInfo;
const loginByPassword = sdkModule.loginByPassword;
const loginByBrowserSSO = sdkModule.loginByBrowserSSO;
const loginByRuntimeSession = sdkModule.loginByRuntimeSession;
const login = sdkModule.login;
const logout = sdkModule.logout;
const getAppSetting = sdkModule.getAppSetting;
const setAppSetting = sdkModule.setAppSetting;
const getCurrentWalletUser = sdkModule.getCurrentWalletUser;
const walletSignWithActiveDid = sdkModule.walletSignWithActiveDid;
const openExternalUrl = sdkModule.openExternalUrl;
const getZoneHostName = sdkModule.getZoneHostName;
const getZoneServiceURL = sdkModule.getZoneServiceURL;
const getServiceRpcClient = sdkModule.getServiceRpcClient;
const getVerifyHubClient = sdkModule.getVerifyHubClient;
const getSystemConfigClient = sdkModule.getSystemConfigClient;
const getTaskManagerClient = sdkModule.getTaskManagerClient;
const getWorkflowClient = sdkModule.getWorkflowClient;
export {
  E as AICC_AI_METHODS,
  F as AICC_CONTROL_METHODS,
  G as AICC_FEATURES,
  A as AICC_SERVICE_NAME,
  C as AICC_SERVICE_SERVICE_NAME,
  D as AICC_SERVICE_SERVICE_PORT,
  z as AICC_SERVICE_UNIQUE_ID,
  Z as AiccClient,
  b as BS_SERVICE_TASK_MANAGER,
  B as BS_SERVICE_VERIFY_HUB,
  f as BuckyOSSDK,
  b2 as DID_OBJECT_SERVICE_ID,
  D2 as DID_OBJECT_SERVICE_TYPE,
  $ as KEventClient,
  _ as KEventReader,
  i as MsgCenterClient,
  M as MsgQueueClient,
  N2 as NODE_IDENTITY_SCHEMA_V2,
  j as RepoClient,
  R as RuntimeType,
  S as SystemConfigClient,
  T as TaskManagerClient,
  V as VerifyHubClient,
  W as WEB3_BRIDGE_HOST,
  k as WORKFLOW_SERVICE_NAME,
  y as WorkflowClient,
  r as WorkflowDefinitionStatus,
  u as WorkflowHumanActionKind,
  o as WorkflowJoinMode,
  t as WorkflowNodeRunState,
  m as WorkflowOutputMode,
  q as WorkflowRetryFallback,
  s as WorkflowRunStatus,
  x as WorkflowScheduledTaskFireStatus,
  w as WorkflowScheduledTaskMisfirePolicy,
  v as WorkflowScheduledTaskStatus,
  l as WorkflowStepType,
  Q as aiccEstimateMessageTextLen,
  K as aiccMessageFirstText,
  J as aiccMessageTextContent,
  P as aiccRenderMessageForDebug,
  O as aiccResponseArtifacts,
  L as aiccResponseTextContent,
  N as aiccResponseToolCalls,
  I as aiccTextMessage,
  attachEvent,
  buckyos,
  createEventReader,
  createSDKModule,
  create_event_reader,
  getAccountInfo,
  g as getActiveRuntimeType,
  e as getActiveSessionToken,
  d as getActiveZoneGatewayOrigin,
  getAppId,
  getAppSetting,
  getBuckyOSConfig,
  getCurrentWalletUser,
  t2 as getDidIdentifier,
  s2 as getDidMethod,
  getKEventClient,
  getRuntimeType,
  getServiceRpcClient,
  getSystemConfigClient,
  getTaskManagerClient,
  getVerifyHubClient,
  getWorkflowClient,
  getZoneHostName,
  getZoneServiceURL,
  h as hashPassword,
  initBuckyOS,
  H as isAiccAiMethod,
  j2 as isBuckyOSAgentDocument,
  l2 as isBuckyOSDIDObjectCard,
  h2 as isBuckyOSDeviceDocument,
  d2 as isBuckyOSDeviceMiniDocument,
  g2 as isBuckyOSLocalNodeIdentityConfig,
  f2 as isBuckyOSNodeIdentityConfig,
  c as isBuckyOSOwnerDocument,
  e2 as isBuckyOSZoneBootDocument,
  m2 as isBuckyOSZoneConfig,
  k2 as isBuckyOSZoneDocument,
  i2 as isW3CDIDDocumentBase,
  login,
  loginByBrowserSSO,
  loginByPassword,
  loginByRuntimeSession,
  logout,
  n2 as namelib,
  n as ndm,
  a as ndm_proxy,
  a2 as ndn,
  openExternalUrl,
  r2 as parseBuckyOSDIDDocument,
  q2 as parseBuckyOSDeviceMiniDocument,
  o2 as parseBuckyOSOwnerDocument,
  p as parseSessionTokenClaims,
  p2 as parseW3CDIDDocumentBase,
  removeEvent,
  setAppSetting,
  subscribeKEvent,
  U as validateAiccMessage,
  X as validateAiccMessages,
  Y as validateAiccResponse,
  walletSignWithActiveDid
};
//# sourceMappingURL=browser.mjs.map
