import jsSHA from 'jssha';
import unixCrypt from 'unix-crypt';
import {buckyos,BS_SERVICE_VERIFY_HUB} from './index';

export interface AccountInfo {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
}
  
// 定义自定义事件
export const LOGIN_EVENT = 'onLogin';

const CRYPT_BASE64_CHARS = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function toCryptBase64(bytes: Uint8Array): string {
    let result = '';
    let buffer = 0;
    let bufferSize = 0;

    for (let i = 0; i < bytes.length; i++) {
        buffer = (buffer << 8) | bytes[i];
        bufferSize += 8;

        while (bufferSize >= 6) {
            bufferSize -= 6;
            const index = (buffer >> bufferSize) & 0x3F;
            result += CRYPT_BASE64_CHARS[index];
        }
    }

    // 处理剩余的位
    if (bufferSize > 0) {
        buffer = buffer << (6 - bufferSize);
        result += CRYPT_BASE64_CHARS[buffer & 0x3F];
    }

    return result;
}

export function hashPassword(username:string,password:string,nonce:number|null=null):string {
    const shaObj = new jsSHA("SHA-512", "TEXT", { encoding: "UTF8" });
    let salt = username+".buckyos";
    shaObj.update(salt + password);
    let hash_bytes = shaObj.getHash("UINT8ARRAY");
    let base64_hash = toCryptBase64(hash_bytes);
    let hash_str = `$6$${salt}$${base64_hash}`;
    if (nonce == null) {
        return hash_str;
    }
    console.log("hash_str: ", hash_str);
    const shaObj2 = new jsSHA("SHA-512", "TEXT", { encoding: "UTF8" });
    let nonce_str = nonce.toString();
    console.log("will hash_str+nonce_str: ", hash_str+nonce_str);
    shaObj2.update(hash_str+nonce_str);
    let result = shaObj2.getHash("B64");
    return result;
}

export function cleanLocalAccountInfo(appId:string) {
    localStorage.removeItem("buckyos.account_info");
    //删除cookie
    let cookie_options = {
        path: "/",
        expires: new Date(0),
        secure: true,
        sameSite: "Lax"
    };
    document.cookie = `${appId}_token=; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join('; ')}`;

}

export function saveLocalAccountInfo(appId:string, account_info:AccountInfo) {
    if(account_info.session_token == null) {
        console.error("session_token is null,can't save account info");
        return;
    }

    localStorage.setItem("buckyos.account_info", JSON.stringify(account_info));
    //session token用cookie存储
    let cookie_options = {
        path: "/",
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30天
        secure: true,
        sameSite: "Lax"
    };
    document.cookie = `${appId}_token=${account_info.session_token}; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join('; ')}`;
}

export function getLocalAccountInfo(appId:string):AccountInfo|null {
    let account_info = localStorage.getItem("buckyos.account_info");
    if(account_info == null) {
        return null;
    }
    return JSON.parse(account_info) as AccountInfo;
}

export async function doLogin(username:string, password:string) {
    let appId = buckyos.getAppId();
    if(appId == null) {
        console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
        return null;
    }

    let login_nonce = Date.now();
    let password_hash = hashPassword(username,password,login_nonce);
    console.log("password_hash: ", password_hash);
    localStorage.removeItem("account_info");
    
    try {
        let rpc_client = buckyos.getServiceRpcClient(BS_SERVICE_VERIFY_HUB);
        let account_info = await rpc_client.call("login", {
            type: "password",
            username: username,
            password: password_hash,
            appid: appId,
            source_url:window.location.href
        }) as AccountInfo;

        saveLocalAccountInfo(appId, account_info);
        return account_info;
    } catch (error) {
        console.error("login failed: ", error);
        throw error;
    }
}


