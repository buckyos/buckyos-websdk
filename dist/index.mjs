import { c as createSDKModule } from "./ndm_client-5e4e5f70.mjs";
import { A, b, B, f, k, K, i, M, j, R, S, T, V, W, g, e, d, J, I, h, y, s, r, q, m, t, u, x, w, v, o, l, z, a, n, H, F, D, G, E, p, C } from "./ndm_client-5e4e5f70.mjs";
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
  A as AiccClient,
  b as BS_SERVICE_TASK_MANAGER,
  B as BS_SERVICE_VERIFY_HUB,
  f as BuckyOSSDK,
  k as KEventClient,
  K as KEventReader,
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
  createEventReader,
  createSDKModule,
  create_event_reader,
  getAccountInfo,
  g as getActiveRuntimeType,
  e as getActiveSessionToken,
  d as getActiveZoneGatewayOrigin,
  getAiccClient,
  getAppId,
  getAppSetting,
  getBuckyOSConfig,
  getCurrentWalletUser,
  J as getDidIdentifier,
  I as getDidMethod,
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
  y as isAgentDocument,
  s as isBuckyOSAgentDocument,
  r as isBuckyOSDeviceDocument,
  q as isBuckyOSDeviceMiniDocument,
  m as isBuckyOSOwnerConfigDocument,
  t as isBuckyOSZoneDocument,
  u as isDIDDocumentBase,
  x as isDeviceDocument,
  w as isDeviceMiniConfig,
  v as isOwnerConfigDocument,
  o as isUserDocument,
  l as isW3CDIDDocumentBase,
  z as isZoneDocument,
  login,
  loginByBrowserSSO,
  loginByPassword,
  loginByRuntimeSession,
  logout,
  a as ndm,
  n as ndn,
  H as parseBuckyOSDIDDocument,
  F as parseBuckyOSDeviceMiniDocument,
  D as parseBuckyOSOwnerConfigDocument,
  G as parseDeviceMiniConfig,
  E as parseOwnerConfigDocument,
  p as parseSessionTokenClaims,
  C as parseW3CDIDDocumentBase,
  removeEvent,
  setAppSetting,
  subscribeKEvent,
  walletSignWithActiveDid
};
//# sourceMappingURL=index.mjs.map
