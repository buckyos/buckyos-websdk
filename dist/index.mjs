import { c as createSDKModule } from "./ndm_client-d52669ab.mjs";
import { A, b, B, f, i, M, j, R, S, T, V, W, g, e, d, h, a, n, p } from "./ndm_client-d52669ab.mjs";
const sdkModule = createSDKModule("universal");
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
const getAiccClient = sdkModule.getAiccClient;
const getMsgQueueClient = sdkModule.getMsgQueueClient;
const getMsgCenterClient = sdkModule.getMsgCenterClient;
const getRepoClient = sdkModule.getRepoClient;
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
  getAiccClient,
  getAppId,
  getAppSetting,
  getBuckyOSConfig,
  getCurrentWalletUser,
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
  login,
  loginByBrowserSSO,
  loginByPassword,
  loginByRuntimeSession,
  logout,
  a as ndm,
  n as ndn,
  p as parseSessionTokenClaims,
  removeEvent,
  setAppSetting,
  walletSignWithActiveDid
};
//# sourceMappingURL=index.mjs.map
