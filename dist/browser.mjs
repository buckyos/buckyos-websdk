import { c as createSDKModule } from "./ndm_proxy-b6d6923d.mjs";
import { H, I, J, D, F, G, E, a0, a7, a8, a3, a4, a5, a6, a9, d, B, ab, aa, af, ad, j, a2, a1, k, M, l, R, S, T, V, W, m, C, u, x, r, w, q, t, v, A, z, y, o, Y, O, N, X, U, P, Q, L, b, ac, e, i, f, g, h, K, n, a, p, s, Z, _, $, ae } from "./ndm_proxy-b6d6923d.mjs";
import { b as b2, D as D2, N as N2, t as t2, s as s2, j as j2, l as l2, h as h2, d as d2, g as g2, f as f2, c, e as e2, m as m2, k as k2, i as i2, n as n2, a as a10, r as r2, q as q2, o as o2, p as p2 } from "./ndn_types-76983121.mjs";
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
  H as AICC_AI_METHODS,
  I as AICC_CONTROL_METHODS,
  J as AICC_FEATURES,
  D as AICC_SERVICE_NAME,
  F as AICC_SERVICE_SERVICE_NAME,
  G as AICC_SERVICE_SERVICE_PORT,
  E as AICC_SERVICE_UNIQUE_ID,
  a0 as AiccClient,
  a7 as BNS_DNS_TXT_DEFAULT_TTL,
  a8 as BNS_DNS_TXT_DOC_TYPE,
  a3 as BNS_EVM_DEFAULT_GAS_LIMIT,
  a4 as BNS_EVM_DEFAULT_MAX_FEE_PER_GAS,
  a5 as BNS_EVM_DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
  a6 as BNS_MAX_INLINE_DOCUMENT_BYTES,
  a9 as BNS_PUBLISH_DOCUMENT_ABI,
  d as BS_SERVICE_TASK_MANAGER,
  B as BS_SERVICE_VERIFY_HUB,
  ab as BnsEvmTxBuilder,
  aa as BnsEvmTxError,
  af as BnsTxExecutor,
  ad as BnsTxExecutorError,
  j as BuckyOSSDK,
  b2 as DID_OBJECT_SERVICE_ID,
  D2 as DID_OBJECT_SERVICE_TYPE,
  a2 as KEventClient,
  a1 as KEventReader,
  k as MsgCenterClient,
  M as MsgQueueClient,
  N2 as NODE_IDENTITY_SCHEMA_V2,
  l as RepoClient,
  R as RuntimeType,
  S as SystemConfigClient,
  T as TaskManagerClient,
  V as VerifyHubClient,
  W as WEB3_BRIDGE_HOST,
  m as WORKFLOW_SERVICE_NAME,
  C as WorkflowClient,
  u as WorkflowDefinitionStatus,
  x as WorkflowHumanActionKind,
  r as WorkflowJoinMode,
  w as WorkflowNodeRunState,
  q as WorkflowOutputMode,
  t as WorkflowRetryFallback,
  v as WorkflowRunStatus,
  A as WorkflowScheduledTaskFireStatus,
  z as WorkflowScheduledTaskMisfirePolicy,
  y as WorkflowScheduledTaskStatus,
  o as WorkflowStepType,
  Y as aiccEstimateMessageTextLen,
  O as aiccMessageFirstText,
  N as aiccMessageTextContent,
  X as aiccRenderMessageForDebug,
  U as aiccResponseArtifacts,
  P as aiccResponseTextContent,
  Q as aiccResponseToolCalls,
  L as aiccTextMessage,
  attachEvent,
  b as bns,
  buckyos,
  createEventReader,
  createSDKModule,
  create_event_reader,
  ac as decodeBnsPublishDocumentCalldata,
  getAccountInfo,
  e as getActiveRuntimeType,
  i as getActiveSessionToken,
  f as getActiveZoneGatewayOrigin,
  getAppId,
  getAppSetting,
  getBuckyOSConfig,
  getCurrentWalletUser,
  g as getCurrentWalletUserFromHost,
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
  K as isAiccAiMethod,
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
  a10 as ndn,
  openExternalUrl,
  r2 as parseBuckyOSDIDDocument,
  q2 as parseBuckyOSDeviceMiniDocument,
  o2 as parseBuckyOSOwnerDocument,
  p as parseSessionTokenClaims,
  p2 as parseW3CDIDDocumentBase,
  removeEvent,
  setAppSetting,
  s as sn,
  subscribeKEvent,
  Z as validateAiccMessage,
  _ as validateAiccMessages,
  $ as validateAiccResponse,
  walletSignWithActiveDid,
  ae as walletUserHasSnAccount
};
//# sourceMappingURL=browser.mjs.map
