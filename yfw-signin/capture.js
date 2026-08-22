/*
 * 药房网凭证捕获脚本 (http-request)
 * 匹配: m.yaofangwang.com/customer/sign_ios.html
 * 仅捕获: ASP.NET_SessionId Cookie
*/

const KEY_COOKIE = "yfw_cookie";
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
    const headers = $request.headers;
    const h = {};
    for (const k in headers) h[k.toLowerCase()] = headers[k];

    const cookieHeader = h["cookie"] || "";
    // 仅需 ASP.NET_SessionId
    const m = cookieHeader.match(/ASP\.NET_SessionId=[^;]+/);
    const sessionId = m ? m[0] : null;

    if (!sessionId) { $done({}); return; }

    const oldCookie = $persistentStore.read(KEY_COOKIE);
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

    if (sessionId !== oldCookie) {
        $persistentStore.write(sessionId, KEY_COOKIE);
        $persistentStore.write(now, KEY_TIME);
        debugLog("捕获 SessionId: " + sessionId);
        console.log("[yfw-signin] 捕获 ASP.NET_SessionId: " + sessionId.substring(0, 32) + "... (" + now + ")");
        $notification.post("药房网签到凭证已更新 ✅", "SessionId 已捕获", "时间: " + now, "");
    } else {
        debugLog("SessionId 无变化，跳过写入");
    }

    $done({});
})();