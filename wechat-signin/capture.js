/*
 * session 自动捕获脚本 (http-request)
 * 用户打开小程序时自动截获最新 third-session / userId / app-id 写入持久存储
 * 匹配域名: zsvip.xomitoto.com
*/

const KEY_SESSION = "zs_session";
const KEY_USERID = "zs_userid";
const KEY_TIME = "zs_capture_time";
const KEY_APPID = "zs_appid";

// Argument 解析（兼容对象 / 逗号分隔字符串两种形态）
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
    const appId = h["app-id"];
    if (!session) { $done({}); return; }

    // 从 URL 提取 userId（部分请求可能不带）
    let userId = null;
    const m = ($request.url || "").match(/userId=(\d+)/);
    if (m) userId = m[1];

    const oldSession = $persistentStore.read(KEY_SESSION);
    const oldUser = $persistentStore.read(KEY_USERID);
    const oldAppId = $persistentStore.read(KEY_APPID);
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

    const sessionChanged = session !== oldSession;
    const userChanged = userId && userId !== oldUser;
    const appIdChanged = appId && appId !== oldAppId;

    debugLog("捕获请求: " + $request.url);
    debugLog("sessionChanged=" + sessionChanged + " userChanged=" + userChanged + " appIdChanged=" + appIdChanged);
    debugLog("当前 userId=" + (userId || "无") + " 旧 userId=" + (oldUser || "无"));

    // 只要 session 变了就写 session、时间
    if (sessionChanged) {
        $persistentStore.write(session, KEY_SESSION);
        $persistentStore.write(now, KEY_TIME);
        debugLog("写入新 session: " + session.substring(0, 8) + "...");
    }

    // 当前请求带 userId 且变了才写
    if (userChanged) {
        $persistentStore.write(userId, KEY_USERID);
        debugLog("写入新 userId: " + userId);
    }

    // app-id 单独维护
    if (appIdChanged) {
        $persistentStore.write(appId, KEY_APPID);
        debugLog("写入新 app-id: " + appId);
    }

    // 只有三件套都在持久存储里才算真正成功并推送
    const hasSession = $persistentStore.read(KEY_SESSION);
    const hasUserId = $persistentStore.read(KEY_USERID);
    const hasAppId = $persistentStore.read(KEY_APPID);

    if (hasSession && hasUserId && hasAppId) {
        if (sessionChanged || userChanged || appIdChanged) {
            console.log("[zs-signin] 凭证完整: session=" + hasSession.substring(0, 8) + "... userId=" + hasUserId + " appId=" + hasAppId);
            $notification.post("签到凭证已更新 ✅", "三件套已就绪", "session/userId/app-id 均已捕获", "");
        }
    } else {
        debugLog("凭证尚不完整: session=" + (hasSession ? "有" : "无") + " userId=" + (hasUserId ? "有" : "无") + " appId=" + (hasAppId ? "有" : "无"));
    }

    $done({});
})();