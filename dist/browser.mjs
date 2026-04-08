import { c as createSDKModule } from "./ndm_proxy-32fcccec.mjs";
import { E, F, G, A, C, D, z, Z, b, B, f, $, _, i, M, j, R, S, T, V, W, k, y, r, u, o, t, m, q, s, x, w, v, l, Q, K, J, P, O, L, N, I, g, e, d, am, al, h, ad, H, a7, a6, a3, a5, a1, a4, a8, a9, ac, ab, aa, a2, a0, ae, n, a, ak, ai, ag, aj, ah, p, af, U, X, Y } from "./ndm_proxy-32fcccec.mjs";
import { n as n2, a as a10 } from "./ndn_types-e2a3628e.mjs";
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
  $ as KEventClient,
  _ as KEventReader,
  i as MsgCenterClient,
  M as MsgQueueClient,
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
  am as getDidIdentifier,
  al as getDidMethod,
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
  ad as isAgentDocument,
  H as isAiccAiMethod,
  a7 as isBuckyOSAgentDocument,
  a6 as isBuckyOSDeviceDocument,
  a3 as isBuckyOSDeviceMiniDocument,
  a5 as isBuckyOSNodeIdentityConfig,
  a1 as isBuckyOSOwnerConfigDocument,
  a4 as isBuckyOSZoneBootConfig,
  a8 as isBuckyOSZoneDocument,
  a9 as isDIDDocumentBase,
  ac as isDeviceDocument,
  ab as isDeviceMiniConfig,
  aa as isOwnerConfigDocument,
  a2 as isUserDocument,
  a0 as isW3CDIDDocumentBase,
  ae as isZoneDocument,
  login,
  loginByBrowserSSO,
  loginByPassword,
  loginByRuntimeSession,
  logout,
  n2 as namelib,
  n as ndm,
  a as ndm_proxy,
  a10 as ndn,
  ak as parseBuckyOSDIDDocument,
  ai as parseBuckyOSDeviceMiniDocument,
  ag as parseBuckyOSOwnerConfigDocument,
  aj as parseDeviceMiniConfig,
  ah as parseOwnerConfigDocument,
  p as parseSessionTokenClaims,
  af as parseW3CDIDDocumentBase,
  removeEvent,
  setAppSetting,
  subscribeKEvent,
  U as validateAiccMessage,
  X as validateAiccMessages,
  Y as validateAiccResponse,
  walletSignWithActiveDid
};
//# sourceMappingURL=browser.mjs.map
