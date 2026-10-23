import jsSHA from 'jssha';

export interface AccountInfo {
    user_name: string;
    user_id: string;
    /**
     * A Zone account type (`admin` | `user` | `limited` | `root`, see
     * `ZoneUserType`) for user sessions, `service` for an AppService runtime.
     * Kept as a string: an unknown value must not break the session.
     */
    user_type?: string;
    session_token: string;
    refresh_token?: string;
}

const BROWSER_USER_INFO_STORAGE_KEY = "user_info";
const BROWSER_IDENTITY_STORAGE_KEY = "buckyos.identity";

export interface BrowserUserInfo {
    user_name: string;
    user_id: string;
    /** Zone account type as verify-hub returned it; see `ZoneUserType`. */
    user_type: string;
}

function getAccountStorageKey(appId:string):string {
    return `buckyos.account_info.${appId}`;
}

function parseBrowserUserInfo(raw:string|null):BrowserUserInfo|null {
    if(raw == null) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as {
            show_name?: unknown;
            user_name?: unknown;
            user_id?: unknown;
            user_type?: unknown;
        };
        const userId = typeof parsed.user_id === 'string' ? parsed.user_id.trim() : '';
        const userType = typeof parsed.user_type === 'string' ? parsed.user_type.trim() : '';
        const userNameCandidate = typeof parsed.user_name === 'string'
            ? parsed.user_name.trim()
            : typeof parsed.show_name === 'string'
                ? parsed.show_name.trim()
                : '';

        if(!userId || !userType) {
            return null;
        }

        return {
            user_name: userNameCandidate || userId,
            user_id: userId,
            user_type: userType,
        };
    } catch {
        return null;
    }
}

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
    localStorage.removeItem(BROWSER_USER_INFO_STORAGE_KEY);
    localStorage.removeItem(BROWSER_IDENTITY_STORAGE_KEY);
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

export function saveBrowserUserInfo(userInfo:BrowserUserInfo) {
    localStorage.setItem(BROWSER_USER_INFO_STORAGE_KEY, JSON.stringify(userInfo));
}

export function getBrowserUserInfo():BrowserUserInfo|null {
    return parseBrowserUserInfo(localStorage.getItem(BROWSER_USER_INFO_STORAGE_KEY));
}

export function clearBrowserUserInfo() {
    localStorage.removeItem(BROWSER_USER_INFO_STORAGE_KEY);
}

/** The last current identity `/sso_refresh` returned (raw JSON, parse with `parseCurrentIdentity`). */
export function saveBrowserIdentity(identity:unknown) {
    localStorage.setItem(BROWSER_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

export function getBrowserIdentityRaw():unknown {
    const raw = localStorage.getItem(BROWSER_IDENTITY_STORAGE_KEY);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function clearBrowserIdentity() {
    localStorage.removeItem(BROWSER_IDENTITY_STORAGE_KEY);
}

