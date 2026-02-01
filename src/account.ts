import jsSHA from 'jssha';
import { buckyos } from './index'
import { VerifyHubClient } from './verify-hub-client'

export interface AccountInfo {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
}
  
// 定义自定义事件
export const LOGIN_EVENT = 'onLogin';

export function hashPassword(username:string,password:string,nonce:number|null=null):string {
    const shaObj = new jsSHA("SHA-256", "TEXT", { encoding: "UTF8" });
    shaObj.update(password+username+".buckyos");
    let org_password_hash_str = shaObj.getHash("B64");
    if (nonce == null) {
        return org_password_hash_str;
    }
    const shaObj2 = new jsSHA("SHA-256", "TEXT", { encoding: "UTF8" });
    let salt = org_password_hash_str + nonce.toString();
    shaObj2.update(salt);
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
        let verify_hub_client = buckyos.getVerifyHubClient();
        verify_hub_client.setSeq(login_nonce);
        let account_response = await verify_hub_client.loginByPassword({
            username: username,
            password: password_hash,
            appid: appId,
            source_url: window.location.href,
        });

        const normalized = VerifyHubClient.normalizeLoginResponse(account_response);
        const account_info: AccountInfo = {
            user_name: normalized.user_name,
            user_id: normalized.user_id,
            user_type: normalized.user_type,
            session_token: normalized.session_token,
        };

        saveLocalAccountInfo(appId, account_info);
        return account_info;
    } catch (error) {
        console.error("login failed: ", error);
        throw error;
    }
}
