import { kRPCClient } from "./krpc_client";
import { AuthClient } from "./auth_client";
import { hashPassword,AccountInfo,doLogin,cleanLocalAccountInfo, getLocalAccountInfo,saveLocalAccountInfo} from "./account";



export interface BuckyOSConfig {
    zone_host_name:string;
    appid:string;
    default_protocol:string; //http:// or https://
}

export const BS_SERVICE_VERIFY_HUB = "verify_hub";

var _current_config:BuckyOSConfig|null = null;
var _current_account_info:AccountInfo|null = null;


const default_config:BuckyOSConfig = {
    zone_host_name:"",
    appid:"",
    default_protocol:"http://",
}

async function tryGetZoneHostName() :Promise<string|null> {

    const protocol = window.location.protocol;
    const host = window.location.host;
    const configUrl = `${protocol}//${host}/zone_config.json`;

    // 发起请求获取配置文件
    try {
        const response = await fetch(configUrl);
        if (response.ok) {
            return host;
        }
    }catch(error) {
    }

    try{
        let up_host = host.split(".").slice(1).join(".");
        const configUrl2 = `${protocol}//${up_host}/zone_config.json`;
        const response2 = await fetch(configUrl2);
        if (response2.ok) {
            return up_host;
        }
    } catch (error) {
    }

    return null;
}

async function initBuckyOS(appid:string,config:BuckyOSConfig|null=null) {
    if(_current_config) {
        console.warn("BuckyOS WebSDK is already initialized!");
    }

    if(config) {
        _current_config = config;
    } else {
        config = default_config;
        config.appid = appid;
        config.default_protocol = window.location.protocol + "//";
        try{
            let up_host = window.location.host.split(".").slice(1).join(".");
            config.zone_host_name = up_host;
        } catch (error) {
            config.zone_host_name = window.location.host;
        }

        let zone_host_name = localStorage.getItem("buckyos.zone_host_name");
        if(zone_host_name) {
            config.zone_host_name = zone_host_name;
        } else {
            zone_host_name = await tryGetZoneHostName();
            if (zone_host_name) {
                localStorage.setItem("buckyos.zone_host_name",zone_host_name);
                config.zone_host_name = zone_host_name;
            }
        }
        return await initBuckyOS(appid,config);
    }
}

function getRuntimeType() {
    // 检查是否在浏览器环境中
    if (typeof window !== 'undefined') {
        // 获取浏览器类型
        const userAgent = window.navigator.userAgent.toLowerCase();
        return "Browser-" + userAgent;

    }
    
    // 检查是否在 Node.js 环境中
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        return "NodeJS-" + process.versions.node;
    }

    return "Unknown";
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
    if(_current_account_info) {
        return _current_account_info;
    }

    if (_current_config == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return null;
    }

    return null;
}


async function login(auto_login:boolean=true) : Promise<AccountInfo|null> {
    if(_current_config == null) {
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
            _current_account_info = account_info;
            return _current_account_info;
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
                _current_account_info = account_info;   
        }
        return account_info;
    } catch (error) {
        console.error("login failed: ", error);
        throw error;
    }
}
    

function logout(clean_account_info:boolean=true) {
    if(_current_config == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return;
    }
    let appId = getAppId();
    if(appId == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return;
    }

    if(_current_account_info == null) {
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
    if(_current_config == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return null;
    }
    return _current_config.zone_host_name;
}

function getZoneServiceURL(service_name:string) :string {
    if(_current_config == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }

    return _current_config.default_protocol + _current_config.zone_host_name+ "/kapi/" + service_name;
}

function getServiceRpcClient(service_name:string) :kRPCClient {
    if(_current_config == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    let session_token = null;
    if(_current_account_info) {
        session_token = _current_account_info.session_token;
    }
    return new kRPCClient(getZoneServiceURL(service_name),session_token);
}

function getAppId() {
    if(_current_config) {
        return _current_config.appid;
    }

    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
}

function getBuckyOSConfig() {
    return _current_config;
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


