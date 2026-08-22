/*
 * session 自动捕获脚本 (http-request)
 * 用户打开小米淘淘小程序时自动截获最新 third-session 写入持久存储
 * 匹配域名: zsvip.xomitoto.com
*/

const KEY_SESSION = "zs_session";
const KEY_TIME = "zs_capture_time";

const ARGS = (function () {
    if (!$argument) return {};
    if (typeof $argument === "string") return { debug: $argument.split(",")[0] === "true" };
    if ($argument[0] !== undefined) return { debug: $argument[0] === "true" };
    return { debug: $argument.DEBUG === true || $argument.DEBUG === "true" };
})();

function debugLog(msg) {
    if (ARGS.debug) console.log("[zs-signin] " + msg);
}

(function () {
    const headers = $request.headers;
    const h = {};
    for (const k in headers) h[k.toLowerCase()] = headers[k];

    const session = h["third-session"];
    if (!session) { $done({}); return; }

    const oldSession = $persistentStore.read(KEY_SESSION);
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

    if (session !== oldSession) {
        $persistentStore.write(session, KEY_SESSION);
        $persistentStore.write(now, KEY_TIME);
        debugLog("写入新 session: " + session.substring(0, 8) + "...");
        console.log("[zs-signin] 捕获 session: " + session.substring(0, 8) + "... (" + now + ")");
        $notification.post("签到凭证已更新 ✅", "session 已自动续期", "时间: " + now, "");
    } else {
        debugLog("session 未变化，跳过写入");
    }

    $done({});
})();