/*
 * 药房网凭证捕获脚本 (http-request)
 * 匹配: m.yaofangwang.com/customer/sign_ios.html
 * 捕获: URL 参数 token + 请求头 Cookie
*/

const KEY_TOKEN = "yfw_token";
const KEY_COOKIE = "yfw_cookie";
const KEY_ACCOUNTID = "yfw_accountid";
const KEY_TIME = "yfw_capture_time";

const ARGS = (function () {
    if (!$argument) return {};
    if (typeof $argument === "string") return { debug: $argument.split(",")[0] === "true" };
    if ($argument[0] !== undefined) return { debug: $argument[0] === "true" };
    return { debug: $argument.DEBUG === true || $argument.DEBUG === "true" };
})();

function debugLog(msg) {
    if (ARGS.debug) console.log("[yfw-signin] " + msg);
}

(function () {
    const url = $request.url || "";
    const headers = $request.headers;
    const h = {};
    for (const k in headers) h[k.toLowerCase()] = headers[k];

    // 从 URL 提取 token
    let token = null;
    const tokenMatch = url.match(/[?&]token=([^&]+)/);
    if (tokenMatch) token = decodeURIComponent(tokenMatch[1]);

    // 从 URL 提取 accountid（签到接口需要）
    let accountId = null;
    const accMatch = url.match(/[?&]accountid=(\d+)/);
    if (accMatch) accountId = accMatch[1];

    // 从 Cookie 头提取关键 Cookie
    const cookieHeader = h["cookie"] || "";
    // 我们需要：ASP.NET_SessionId, unioncooike, HMF_CI, HMY_JC 等
    const neededCookies = ["ASP.NET_SessionId", "unioncooike", "HMF_CI", "HMY_JC", "real_ip"];
    const capturedCookies = [];
    for (const name of neededCookies) {
        const regex = new RegExp(name + "=[^;]+");
        const m = cookieHeader.match(regex);
        if (m) capturedCookies.push(m[0]);
    }
    const cookieStr = capturedCookies.join("; ");

    const oldToken = $persistentStore.read(KEY_TOKEN);
    const oldCookie = $persistentStore.read(KEY_COOKIE);
    const oldAccountId = $persistentStore.read(KEY_ACCOUNTID);
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

    let updated = false;

    if (token && token !== oldToken) {
        $persistentStore.write(token, KEY_TOKEN);
        debugLog("捕获 token: " + token.substring(0, 16) + "...");
        updated = true;
    }

    if (cookieStr && cookieStr !== oldCookie) {
        $persistentStore.write(cookieStr, KEY_COOKIE);
        debugLog("捕获 Cookie: " + cookieStr.substring(0, 50) + "...");
        updated = true;
    }

    if (accountId && accountId !== oldAccountId) {
        $persistentStore.write(accountId, KEY_ACCOUNTID);
        debugLog("捕获 accountId: " + accountId);
        updated = true;
    }

    if (updated) {
        $persistentStore.write(now, KEY_TIME);
        console.log("[yfw-signin] 凭证更新: token=" + (token ? "有" : "无") + " cookie=" + (cookieStr ? "有" : "无") + " accountId=" + (accountId || "无") + " (" + now + ")");
        $notification.post("药房网签到凭证已更新 ✅", "token/Cookie/accountId 已捕获", "时间: " + now, "");
    } else {
        debugLog("凭证无变化，跳过写入");
    }

    $done({});
})();