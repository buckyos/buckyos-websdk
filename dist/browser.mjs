import { c as createSDKModule } from "./ndm_proxy-20abe498.mjs";
import { q, r, s, A, m, o, l, D, d, B, i, E, K, j, M, k, R, S, T, V, W, y, w, v, x, u, g, f, e, a4, a3, h, X, t, L, J, I, G, N, O, U, Q, P, H, F, Y, a, b, n, a2, a0, _, a1, $, p, Z, z, C } from "./ndm_proxy-20abe498.mjs";
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
export {
  q as AICC_AI_METHODS,
  r as AICC_CONTROL_METHODS,
  s as AICC_FEATURES,
  A as AICC_SERVICE_NAME,
  m as AICC_SERVICE_SERVICE_NAME,
  o as AICC_SERVICE_SERVICE_PORT,
  l as AICC_SERVICE_UNIQUE_ID,
  D as AiccClient,
  d as BS_SERVICE_TASK_MANAGER,
  B as BS_SERVICE_VERIFY_HUB,
  i as BuckyOSSDK,
  E as KEventClient,
  K as KEventReader,
  j as MsgCenterClient,
  M as MsgQueueClient,
  k as RepoClient,
  R as RuntimeType,
  S as SystemConfigClient,
  T as TaskManagerClient,
  V as VerifyHubClient,
  W as WEB3_BRIDGE_HOST,
  y as aiccEstimateMessageTextLen,
  w as aiccMessageFirstText,
  v as aiccMessageTextContent,
  x as aiccRenderMessageForDebug,
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
  getAppId,
  getAppSetting,
  getBuckyOSConfig,
  getCurrentWalletUser,
  a4 as getDidIdentifier,
  a3 as getDidMethod,
  getKEventClient,
  getRuntimeType,
  getServiceRpcClient,
  getSystemConfigClient,
  getTaskManagerClient,
  getVerifyHubClient,
  getZoneHostName,
  getZoneServiceURL,
  h as hashPassword,
  initBuckyOS,
  X as isAgentDocument,
  t as isAiccAiMethod,
  L as isBuckyOSAgentDocument,
  J as isBuckyOSDeviceDocument,
  I as isBuckyOSDeviceMiniDocument,
  G as isBuckyOSOwnerConfigDocument,
  N as isBuckyOSZoneDocument,
  O as isDIDDocumentBase,
  U as isDeviceDocument,
  Q as isDeviceMiniConfig,
  P as isOwnerConfigDocument,
  H as isUserDocument,
  F as isW3CDIDDocumentBase,
  Y as isZoneDocument,
  login,
  loginByBrowserSSO,
  loginByPassword,
  loginByRuntimeSession,
  logout,
  a as ndm,
  b as ndm_proxy,
  n as ndn,
  a2 as parseBuckyOSDIDDocument,
  a0 as parseBuckyOSDeviceMiniDocument,
  _ as parseBuckyOSOwnerConfigDocument,
  a1 as parseDeviceMiniConfig,
  $ as parseOwnerConfigDocument,
  p as parseSessionTokenClaims,
  Z as parseW3CDIDDocumentBase,
  removeEvent,
  setAppSetting,
  subscribeKEvent,
  z as validateAiccMessage,
  C as validateAiccMessages,
  walletSignWithActiveDid
};
//# sourceMappingURL=browser.mjs.map
