import { kRPCClient } from "./krpc_client";
import { AuthClient } from "./auth_client";
import { hashPassword,AccountInfo,doLogin,cleanLocalAccountInfo, getLocalAccountInfo,saveLocalAccountInfo} from "./account";

export enum RuntimeType {
    Browser = "Browser",
    NodeJS = "NodeJS",
    AppRuntime = "AppRuntime",
    Unknown = "Unknown"
}

export interface BuckyOSConfig {
    zoneHost:string;
    appId:string;
    defaultProtocol:string; //http:// or https://
    runtimeType:RuntimeType;
}


export const WEB3_BRIDGE_HOST = "web3.buckyos.ai";

export const BS_SERVICE_VERIFY_HUB = "verify-hub";

var _currentConfig: BuckyOSConfig | null = null;
var _currentAccountInfo: AccountInfo | null = null;

const DEFAULT_CONFIG: BuckyOSConfig = {
    zoneHost: "",
    appId: "",
    defaultProtocol: "http://",
    runtimeType: RuntimeType.Unknown
}

async function tryGetZoneHostName(appid:string,host:string,default_protocol:string) :Promise<string> {

    //用当前域名，或上级域名尝试访问 /1.0/identifiers/self
    let zone_doc_url = default_protocol + host + "/1.0/identifiers/self";
    let response = await fetch(zone_doc_url);
    if(response.status == 200) {
        return host;
    } else {
        let up_host = host.split(".").slice(1).join(".");
        zone_doc_url = default_protocol + up_host + "/1.0/identifiers/self";
        response = await fetch(zone_doc_url);
        if(response.status == 200) {
            return up_host;
        }
    }
    
    return host;
}



async function initBuckyOS(appid:string,config:BuckyOSConfig|null=null): Promise<void> {
    if(_currentConfig) {
        console.warn("BuckyOS WebSDK is already initialized!");
    }

    if(config) {
        _currentConfig = config;
    } else {
        config = DEFAULT_CONFIG;
        config.appId = appid;
        config.defaultProtocol = window.location.protocol + "//";

        let zone_host_name = localStorage.getItem("zone_host_name");
        if(zone_host_name) {
            config.zoneHost = zone_host_name;
        } else {
            zone_host_name = await tryGetZoneHostName(appid,window.location.host,config.defaultProtocol);
            localStorage.setItem("zone_host_name", zone_host_name);
            config.zoneHost = zone_host_name;
   
        }
        return await initBuckyOS(appid,config);
    }
}



function getRuntimeType(): RuntimeType {
    // 检查是否在浏览器环境中
    if (typeof window !== 'undefined') {
        if ((window as any).BuckyApi) {
            return RuntimeType.AppRuntime;
        }
        return RuntimeType.Browser;
    }

    const runtimeProcess = (globalThis as { process?: { versions?: { node?: string; electron?: string } } }).process;
    // 检查是否在 Node.js 环境中
    if (runtimeProcess?.versions?.node) {
        return RuntimeType.NodeJS;
    }

    return RuntimeType.Unknown;
}


function attachEvent(event_name:string, callback:Function) {
    //TODO: implement
}

function removeEvent(cookie_id:string) {
    //TODO: implement
}

//return null if not login
function getAccountInfo() : AccountInfo|null {
    //TODO: implement
    if(_currentAccountInfo) {
        return _currentAccountInfo;
    }

    if (_currentConfig == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return null;
    }

    return null;
}


async function login(auto_login:boolean=true) : Promise<AccountInfo|null> {
    if(_currentConfig == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return null;
    }
    let appId = getAppId();
    if(appId == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return null;
    }

    if(auto_login) {
        let account_info = getLocalAccountInfo(appId);
        if(account_info) {
            _currentAccountInfo = account_info;
            return _currentAccountInfo;
        } 
    }   

    cleanLocalAccountInfo(appId);
    //use auth_client to login
    let zone_host_name = getZoneHostName();
    if(zone_host_name == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return null;
    }
    try {
        let auth_client = new AuthClient(zone_host_name,appId);
        let account_info = await auth_client.login();
        if (account_info) {
            saveLocalAccountInfo(appId,account_info);
            _currentAccountInfo = account_info;   
        }
        return account_info;
    } catch (error) {
        console.error("login failed: ", error);
        throw error;
    }
}
    

function logout(clean_account_info:boolean=true) {
    if(_currentConfig == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return;
    }
    let appId = getAppId();
    if(appId == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return;
    }

    if(_currentAccountInfo == null) {
        console.error("BuckyOS WebSDK is not login,call login first");
        return;
    }

    if(clean_account_info) {
        cleanLocalAccountInfo(appId);
    }
}

function getAppSetting(setting_name:string|null=null) {
    //TODO: implement
}

function setAppSetting(setting_name:string|null=null, setting_value:string) {
    //TODO: implement
}

function getZoneHostName() :string|null {
    if(_currentConfig == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return null;
    }
    return _currentConfig.zoneHost;
}

function getZoneServiceURL(service_name:string) :string {
    return "/kapi/" + service_name;
}

function getServiceRpcClient(service_name:string) :kRPCClient {
    if(_currentConfig == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    let session_token = null;
    if(_currentAccountInfo) {
        session_token = _currentAccountInfo.session_token;
    }
    return new kRPCClient(getZoneServiceURL(service_name),session_token);
}

function getAppId() {
    if(_currentConfig) {
        return _currentConfig.appId;
    }

    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
}

function getBuckyOSConfig() {
    return _currentConfig;
}

async function getCurrentWalletUser () : Promise<any> {
    const result : any = await (window as any).BuckyApi.getCurrentUser();
    if (result.code == 0) {
        return result.data;
    } else {
        console.error("BuckyApi.getCurrentUser failed: ", result.message);
        return null;
    }
}

async function walletSignWithActiveDid(payloads:Record<string, unknown>[]) : Promise<string[] | null> {
    const result : any= await (window as any).BuckyApi. signJsonWithActiveDid (payloads);
    if (result.code == 0) {
        return result.data.signatures;
    } else {
        console.error("BuckyApi.signWithActiveDid failed: ", result.message);
        return null;
    }
}

export const buckyos = {
    kRPCClient,
    AuthClient,
    initBuckyOS,
    getBuckyOSConfig,
    getRuntimeType,
    getAppId,
    attachEvent,
    removeEvent,
    getAccountInfo,
    doLogin,
    login,
    logout,
    hashPassword,
    getAppSetting,
    setAppSetting,
    getCurrentWalletUser,
    walletSignWithActiveDid,
    //add_web3_bridge,        
    getZoneHostName,
    getZoneServiceURL,
    getServiceRpcClient,
}

