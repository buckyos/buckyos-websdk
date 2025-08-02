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

async function tryGetZoneHostName(appid:string,host:string) :Promise<string|null> {

    //host can be  
    // bob.web3.buckyos.ai => bob.web3.buckyos.ai
    // appid-bob.web3.buckyos.ai => bob.web3.buckyos.ai
    // appid.bob.web3.buckyos.ai => bob.web3.buckyos.ai
    // bob.me => bob.me
    // appid.bob.me => bob.me
    // appid-bob.me => bob.me
    if (!host.startsWith(appid)) { 
        return host;
    } else if (host.startsWith(appid+"-")) {
        let parts = host.split(".");
        let first_part = parts[0];
        let part_name = first_part.split("-")[-1];
        return part_name + "." + parts.slice(1).join(".");

    } else if (host.startsWith(appid+".")) {
        let parts = host.split(".");
        return parts.join(".");
    } 
    
    return host;
}

// 获取存储键名，支持子域名共享
function getStorageKey(key: string): string {
    const domain = window.location.hostname.split('.').slice(-2).join('.');
    return `buckyos.${domain}.${key}`;
}

async function initBuckyOS(appid:string,config:BuckyOSConfig|null=null) {
    if(_currentConfig) {
        console.warn("BuckyOS WebSDK is already initialized!");
    }

    if(config) {
        _currentConfig = config;
    } else {
        config = DEFAULT_CONFIG;
        config.appId = appid;
        config.defaultProtocol = window.location.protocol + "//";
        try{
            let up_host = window.location.host.split(".").slice(1).join(".");
            config.zoneHost = up_host;
        } catch (error) {
            config.zoneHost = window.location.host;
        }

        let zone_host_name = localStorage.getItem(getStorageKey("zone_host_name"));
        if(zone_host_name) {
            config.zoneHost = zone_host_name;
        } else {
            let this_host = window.location.host;
            zone_host_name = await tryGetZoneHostName(appid,this_host);
            if (zone_host_name) {
                localStorage.setItem(getStorageKey("zone_host_name"), zone_host_name);
                config.zoneHost = zone_host_name;
            }
        }
        return await initBuckyOS(appid,config);
    }
}



function getRuntimeType(): RuntimeType {
    // 检查是否在浏览器环境中
    if (typeof window !== 'undefined') {
        return RuntimeType.Browser;
    }
    
    // 检查是否在 Node.js 环境中
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        return RuntimeType.NodeJS;
    }

    // 检查是否在electron (buckyos desktop runtime)环境中
    if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
        return RuntimeType.AppRuntime;
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
    if(_currentConfig == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }

    return _currentConfig.defaultProtocol + _currentConfig.zoneHost+ "/kapi/" + service_name;
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
    
    //add_web3_bridge,        
    getZoneHostName,
    getZoneServiceURL,
    getServiceRpcClient,
}


