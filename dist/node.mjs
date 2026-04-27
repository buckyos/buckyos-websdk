import { c as createSDKModule } from "./ndm_proxy-6494c8e7.mjs";
import { A, d, B, i, l, K, j, M, k, R, S, T, V, W, g, f, e, L, J, h, z, t, s, r, o, u, v, y, x, w, q, m, C, a, b, n, I, G, E, H, F, p, D } from "./ndm_proxy-6494c8e7.mjs";
const sdkModule = createSDKModule("node");
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
  A as AiccClient,
  d as BS_SERVICE_TASK_MANAGER,
  B as BS_SERVICE_VERIFY_HUB,
  i as BuckyOSSDK,
  l as KEventClient,
  K as KEventReader,
  j as MsgCenterClient,
  M as MsgQueueClient,
  k as RepoClient,
  R as RuntimeType,
  S as SystemConfigClient,
  T as TaskManagerClient,
  V as VerifyHubClient,
  W as WEB3_BRIDGE_HOST,
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
  L as getDidIdentifier,
  J as getDidMethod,
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
  z as isAgentDocument,
  t as isBuckyOSAgentDocument,
  s as isBuckyOSDeviceDocument,
  r as isBuckyOSDeviceMiniDocument,
  o as isBuckyOSOwnerConfigDocument,
  u as isBuckyOSZoneDocument,
  v as isDIDDocumentBase,
  y as isDeviceDocument,
  x as isDeviceMiniConfig,
  w as isOwnerConfigDocument,
  q as isUserDocument,
  m as isW3CDIDDocumentBase,
  C as isZoneDocument,
  login,
  loginByBrowserSSO,
  loginByPassword,
  loginByRuntimeSession,
  logout,
  a as ndm,
  b as ndm_proxy,
  n as ndn,
  I as parseBuckyOSDIDDocument,
  G as parseBuckyOSDeviceMiniDocument,
  E as parseBuckyOSOwnerConfigDocument,
  H as parseDeviceMiniConfig,
  F as parseOwnerConfigDocument,
  p as parseSessionTokenClaims,
  D as parseW3CDIDDocumentBase,
  removeEvent,
  setAppSetting,
  subscribeKEvent,
  walletSignWithActiveDid
};
//# sourceMappingURL=node.mjs.map
