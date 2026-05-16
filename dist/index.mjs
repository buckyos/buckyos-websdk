import { c as createSDKModule } from "./ndm_proxy-b041b938.mjs";
import { q, r, s, A, m, o, l, H, d, B, i, I, K, j, M, k, R, S, T, V, W, D, w, v, C, z, x, y, u, g, f, e, a8, a7, h, $, t, Q, P, O, L, U, X, _, Z, Y, N, J, a0, a, b, n, a6, a4, a2, a5, a3, p, a1, E, F, G } from "./ndm_proxy-b041b938.mjs";
const sdkModule = createSDKModule("universal");
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
const getAiccClient = sdkModule.getAiccClient;
const getMsgQueueClient = sdkModule.getMsgQueueClient;
const getMsgCenterClient = sdkModule.getMsgCenterClient;
const getRepoClient = sdkModule.getRepoClient;
export {
  q as AICC_AI_METHODS,
  r as AICC_CONTROL_METHODS,
  s as AICC_FEATURES,
  A as AICC_SERVICE_NAME,
  m as AICC_SERVICE_SERVICE_NAME,
  o as AICC_SERVICE_SERVICE_PORT,
  l as AICC_SERVICE_UNIQUE_ID,
  H as AiccClient,
  d as BS_SERVICE_TASK_MANAGER,
  B as BS_SERVICE_VERIFY_HUB,
  i as BuckyOSSDK,
  I as KEventClient,
  K as KEventReader,
  j as MsgCenterClient,
  M as MsgQueueClient,
  k as RepoClient,
  R as RuntimeType,
  S as SystemConfigClient,
  T as TaskManagerClient,
  V as VerifyHubClient,
  W as WEB3_BRIDGE_HOST,
  D as aiccEstimateMessageTextLen,
  w as aiccMessageFirstText,
  v as aiccMessageTextContent,
  C as aiccRenderMessageForDebug,
  z as aiccResponseArtifacts,
  x as aiccResponseTextContent,
  y as aiccResponseToolCalls,
  u as aiccTextMessage,
  attachEvent,
  buckyos,
  createEventReader,
  createSDKModule,
  create_event_reader,
  getAccountInfo,
  g as getActiveRuntimeType,
  f as getActiveSessionToken,
  e as getActiveZoneGatewayOrigin,
  getAiccClient,
  getAppId,
  getAppSetting,
  getBuckyOSConfig,
  getCurrentWalletUser,
  a8 as getDidIdentifier,
  a7 as getDidMethod,
  getKEventClient,
  getMsgCenterClient,
  getMsgQueueClient,
  getRepoClient,
  getRuntimeType,
  getServiceRpcClient,
  getSystemConfigClient,
  getTaskManagerClient,
  getVerifyHubClient,
  getZoneHostName,
  getZoneServiceURL,
  h as hashPassword,
  initBuckyOS,
  $ as isAgentDocument,
  t as isAiccAiMethod,
  Q as isBuckyOSAgentDocument,
  P as isBuckyOSDeviceDocument,
  O as isBuckyOSDeviceMiniDocument,
  L as isBuckyOSOwnerConfigDocument,
  U as isBuckyOSZoneDocument,
  X as isDIDDocumentBase,
  _ as isDeviceDocument,
  Z as isDeviceMiniConfig,
  Y as isOwnerConfigDocument,
  N as isUserDocument,
  J as isW3CDIDDocumentBase,
  a0 as isZoneDocument,
  login,
  loginByBrowserSSO,
  loginByPassword,
  loginByRuntimeSession,
  logout,
  a as ndm,
  b as ndm_proxy,
  n as ndn,
  a6 as parseBuckyOSDIDDocument,
  a4 as parseBuckyOSDeviceMiniDocument,
  a2 as parseBuckyOSOwnerConfigDocument,
  a5 as parseDeviceMiniConfig,
  a3 as parseOwnerConfigDocument,
  p as parseSessionTokenClaims,
  a1 as parseW3CDIDDocumentBase,
  removeEvent,
  setAppSetting,
  subscribeKEvent,
  E as validateAiccMessage,
  F as validateAiccMessages,
  G as validateAiccResponse,
  walletSignWithActiveDid
};
//# sourceMappingURL=index.mjs.map
