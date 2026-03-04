import jsSHA from 'jssha';
import { buckyos } from './index'
import { VerifyHubClient } from './verify-hub-client'

export interface AccountInfo {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
    refresh_token?: string;
}

const LEGACY_ACCOUNT_STORAGE_KEY = "buckyos.account_info";

function getAccountStorageKey(appId:string):string {
    return `buckyos.account_info.${appId}`;
}

function parseAccountInfo(raw:string|null):AccountInfo|null {
    if(raw == null) {
        return null;
    }

    try {
        return JSON.parse(raw) as AccountInfo;
    } catch {
        return null;
    }
}

function parseTokenAppId(sessionToken:string):string|null {
    const parts = sessionToken.split('.');
    if(parts.length < 2) {
        return null;
    }

    try {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const payload = JSON.parse(atob(padded)) as { appid?: unknown };
        if(typeof payload.appid === 'string' && payload.appid.trim().length > 0) {
            return payload.appid;
        }
    } catch {
        return null;
    }

    return null;
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
    localStorage.removeItem(getAccountStorageKey(appId));
    const legacy = parseAccountInfo(localStorage.getItem(LEGACY_ACCOUNT_STORAGE_KEY));
    if(legacy?.session_token && parseTokenAppId(legacy.session_token) === appId) {
        localStorage.removeItem(LEGACY_ACCOUNT_STORAGE_KEY);
    }
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

    localStorage.setItem(getAccountStorageKey(appId), JSON.stringify(account_info));
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
    const scoped = parseAccountInfo(localStorage.getItem(getAccountStorageKey(appId)));
    if(scoped != null) {
        return scoped;
    }

    const legacy = parseAccountInfo(localStorage.getItem(LEGACY_ACCOUNT_STORAGE_KEY));
    if(legacy?.session_token && parseTokenAppId(legacy.session_token) === appId) {
        localStorage.setItem(getAccountStorageKey(appId), JSON.stringify(legacy));
        return legacy;
    }

    return null;
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
    localStorage.removeItem(getAccountStorageKey(appId));
    
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
            refresh_token: normalized.refresh_token,
        };

        saveLocalAccountInfo(appId, account_info);
        return account_info;
    } catch (error) {
        console.error("login failed: ", error);
        throw error;
    }
}
