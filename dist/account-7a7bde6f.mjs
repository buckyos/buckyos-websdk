import { b7 as ht } from "./ndn_types-0fac2499.mjs";
const BROWSER_USER_INFO_STORAGE_KEY = "user_info";
const BROWSER_IDENTITY_STORAGE_KEY = "buckyos.identity";
function getAccountStorageKey(appId) {
  return `buckyos.account_info.${appId}`;
}
function parseBrowserUserInfo(raw) {
  if (raw == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const userId = typeof parsed.user_id === "string" ? parsed.user_id.trim() : "";
    const userType = typeof parsed.user_type === "string" ? parsed.user_type.trim() : "";
    const userNameCandidate = typeof parsed.user_name === "string" ? parsed.user_name.trim() : typeof parsed.show_name === "string" ? parsed.show_name.trim() : "";
    if (!userId || !userType) {
      return null;
    }
    return {
      user_name: userNameCandidate || userId,
      user_id: userId,
      user_type: userType
    };
  } catch {
    return null;
  }
}
function hashPassword(username, password, nonce = null) {
  const shaObj = new ht("SHA-256", "TEXT", { encoding: "UTF8" });
  shaObj.update(password + username + ".buckyos");
  let org_password_hash_str = shaObj.getHash("B64");
  if (nonce == null) {
    return org_password_hash_str;
  }
  const shaObj2 = new ht("SHA-256", "TEXT", { encoding: "UTF8" });
  let salt = org_password_hash_str + nonce.toString();
  shaObj2.update(salt);
  let result = shaObj2.getHash("B64");
  return result;
}
function cleanLocalAccountInfo(appId) {
  localStorage.removeItem(getAccountStorageKey(appId));
  localStorage.removeItem(BROWSER_USER_INFO_STORAGE_KEY);
  localStorage.removeItem(BROWSER_IDENTITY_STORAGE_KEY);
  let cookie_options = {
    path: "/",
    expires: /* @__PURE__ */ new Date(0),
    secure: true,
    sameSite: "Lax"
  };
  document.cookie = `${appId}_token=; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join("; ")}`;
}
function saveLocalAccountInfo(appId, account_info) {
  if (account_info.session_token == null) {
    console.error("session_token is null,can't save account info");
    return;
  }
  localStorage.setItem(getAccountStorageKey(appId), JSON.stringify(account_info));
  let cookie_options = {
    path: "/",
    expires: new Date(Date.now() + 1e3 * 60 * 60 * 24 * 30),
    // 30天
    secure: true,
    sameSite: "Lax"
  };
  document.cookie = `${appId}_token=${account_info.session_token}; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join("; ")}`;
}
function saveBrowserUserInfo(userInfo) {
  localStorage.setItem(BROWSER_USER_INFO_STORAGE_KEY, JSON.stringify(userInfo));
}
function getBrowserUserInfo() {
  return parseBrowserUserInfo(localStorage.getItem(BROWSER_USER_INFO_STORAGE_KEY));
}
function clearBrowserUserInfo() {
  localStorage.removeItem(BROWSER_USER_INFO_STORAGE_KEY);
}
function saveBrowserIdentity(identity) {
  localStorage.setItem(BROWSER_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}
function getBrowserIdentityRaw() {
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
function clearBrowserIdentity() {
  localStorage.removeItem(BROWSER_IDENTITY_STORAGE_KEY);
}
export {
  saveBrowserUserInfo as a,
  getBrowserUserInfo as b,
  clearBrowserUserInfo as c,
  clearBrowserIdentity as d,
  saveLocalAccountInfo as e,
  cleanLocalAccountInfo as f,
  getBrowserIdentityRaw as g,
  hashPassword as h,
  saveBrowserIdentity as s
};
//# sourceMappingURL=account-7a7bde6f.mjs.map
