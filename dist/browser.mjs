import { c as createSDKModule } from "./ndm_proxy-eef905cd.mjs";
import { F, G, H, A, D, E, C, _, d, B, i, a0, $, j, M, k, R, S, T, V, W, l, z, s, v, q, u, o, r, t, y, x, w, m, U, L, K, Q, P, N, O, J, b, g, f, e, h, I, n, a, p, X, Y, Z } from "./ndm_proxy-eef905cd.mjs";
import { b as b2, D as D2, N as N2, t as t2, s as s2, j as j2, l as l2, h as h2, d as d2, g as g2, f as f2, c, e as e2, m as m2, k as k2, i as i2, n as n2, a as a2, r as r2, q as q2, o as o2, p as p2 } from "./ndn_types-089ba30c.mjs";
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
  F as AICC_AI_METHODS,
  G as AICC_CONTROL_METHODS,
  H as AICC_FEATURES,
  A as AICC_SERVICE_NAME,
  D as AICC_SERVICE_SERVICE_NAME,
  E as AICC_SERVICE_SERVICE_PORT,
  C as AICC_SERVICE_UNIQUE_ID,
  _ as AiccClient,
  d as BS_SERVICE_TASK_MANAGER,
  B as BS_SERVICE_VERIFY_HUB,
  i as BuckyOSSDK,
  b2 as DID_OBJECT_SERVICE_ID,
  D2 as DID_OBJECT_SERVICE_TYPE,
  a0 as KEventClient,
  $ as KEventReader,
  j as MsgCenterClient,
  M as MsgQueueClient,
  N2 as NODE_IDENTITY_SCHEMA_V2,
  k as RepoClient,
  R as RuntimeType,
  S as SystemConfigClient,
  T as TaskManagerClient,
  V as VerifyHubClient,
  W as WEB3_BRIDGE_HOST,
  l as WORKFLOW_SERVICE_NAME,
  z as WorkflowClient,
  s as WorkflowDefinitionStatus,
  v as WorkflowHumanActionKind,
  q as WorkflowJoinMode,
  u as WorkflowNodeRunState,
  o as WorkflowOutputMode,
  r as WorkflowRetryFallback,
  t as WorkflowRunStatus,
  y as WorkflowScheduledTaskFireStatus,
  x as WorkflowScheduledTaskMisfirePolicy,
  w as WorkflowScheduledTaskStatus,
  m as WorkflowStepType,
  U as aiccEstimateMessageTextLen,
  L as aiccMessageFirstText,
  K as aiccMessageTextContent,
  Q as aiccRenderMessageForDebug,
  P as aiccResponseArtifacts,
  N as aiccResponseTextContent,
  O as aiccResponseToolCalls,
  J as aiccTextMessage,
  attachEvent,
  b as bns,
  buckyos,
  createEventReader,
  createSDKModule,
  create_event_reader,
  getAccountInfo,
  g as getActiveRuntimeType,
  f as getActiveSessionToken,
  e as getActiveZoneGatewayOrigin,
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
  I as isAiccAiMethod,
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
  X as validateAiccMessage,
  Y as validateAiccMessages,
  Z as validateAiccResponse,
  walletSignWithActiveDid
};
//# sourceMappingURL=browser.mjs.map
