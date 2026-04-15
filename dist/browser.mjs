import { c as createSDKModule } from "./ndm_client-ab8fdf16.mjs";
import { A, b, B, f, i, M, j, R, S, T, V, W, g, e, d, I, H, h, x, r, q, o, l, s, t, w, v, u, m, k, y, a, n, G, E, C, F, D, p, z } from "./ndm_client-ab8fdf16.mjs";
const sdkModule = createSDKModule("browser");
const buckyos = sdkModule.buckyos;
const initBuckyOS = sdkModule.initBuckyOS;
const getBuckyOSConfig = sdkModule.getBuckyOSConfig;
const getRuntimeType = sdkModule.getRuntimeType;
const getAppId = sdkModule.getAppId;
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
  b as BS_SERVICE_TASK_MANAGER,
  B as BS_SERVICE_VERIFY_HUB,
  f as BuckyOSSDK,
  i as MsgCenterClient,
  M as MsgQueueClient,
  j as RepoClient,
  R as RuntimeType,
  S as SystemConfigClient,
  T as TaskManagerClient,
  V as VerifyHubClient,
  W as WEB3_BRIDGE_HOST,
  attachEvent,
  buckyos,
  createSDKModule,
  getAccountInfo,
  g as getActiveRuntimeType,
  e as getActiveSessionToken,
  d as getActiveZoneGatewayOrigin,
  getAppId,
  getAppSetting,
  getBuckyOSConfig,
  getCurrentWalletUser,
  I as getDidIdentifier,
  H as getDidMethod,
  getRuntimeType,
  getServiceRpcClient,
  getSystemConfigClient,
  getTaskManagerClient,
  getVerifyHubClient,
  getZoneHostName,
  getZoneServiceURL,
  h as hashPassword,
  initBuckyOS,
  x as isAgentDocument,
  r as isBuckyOSAgentDocument,
  q as isBuckyOSDeviceDocument,
  o as isBuckyOSDeviceMiniDocument,
  l as isBuckyOSOwnerConfigDocument,
  s as isBuckyOSZoneDocument,
  t as isDIDDocumentBase,
  w as isDeviceDocument,
  v as isDeviceMiniConfig,
  u as isOwnerConfigDocument,
  m as isUserDocument,
  k as isW3CDIDDocumentBase,
  y as isZoneDocument,
  login,
  loginByBrowserSSO,
  loginByPassword,
  loginByRuntimeSession,
  logout,
  a as ndm,
  n as ndn,
  G as parseBuckyOSDIDDocument,
  E as parseBuckyOSDeviceMiniDocument,
  C as parseBuckyOSOwnerConfigDocument,
  F as parseDeviceMiniConfig,
  D as parseOwnerConfigDocument,
  p as parseSessionTokenClaims,
  z as parseW3CDIDDocumentBase,
  removeEvent,
  setAppSetting,
  walletSignWithActiveDid
};
//# sourceMappingURL=browser.mjs.map
