import { createSDKModule } from './sdk_core'
import { hashPassword } from './account'

const sdkModule = createSDKModule('browser')

export const buckyos = sdkModule.buckyos
export const initBuckyOS = sdkModule.initBuckyOS
export const getBuckyOSConfig = sdkModule.getBuckyOSConfig
export const getRuntimeType = sdkModule.getRuntimeType
export const getAppId = sdkModule.getAppId
export const attachEvent = sdkModule.attachEvent
export const removeEvent = sdkModule.removeEvent
export const getAccountInfo = sdkModule.getAccountInfo
export const doLogin = sdkModule.doLogin
export const login = sdkModule.login
export const logout = sdkModule.logout
export const getAppSetting = sdkModule.getAppSetting
export const setAppSetting = sdkModule.setAppSetting
export const getCurrentWalletUser = sdkModule.getCurrentWalletUser
export const walletSignWithActiveDid = sdkModule.walletSignWithActiveDid
export const openExternalUrl = sdkModule.openExternalUrl
export const getZoneHostName = sdkModule.getZoneHostName
export const getZoneServiceURL = sdkModule.getZoneServiceURL
export const getServiceRpcClient = sdkModule.getServiceRpcClient
export const getVerifyHubClient = sdkModule.getVerifyHubClient
export const getSystemConfigClient = sdkModule.getSystemConfigClient
export const getTaskManagerClient = sdkModule.getTaskManagerClient
export const getOpenDanClient = sdkModule.getOpenDanClient

export { hashPassword }
export * from './sdk_core'
