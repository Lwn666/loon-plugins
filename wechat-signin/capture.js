/*
 * session 自动捕获脚本 (http-request)
 * 用户打开小程序时自动截获最新 third-session + userId 写入持久存储
 * 匹配域名: zsvip.xomitoto.com
*/

const KEY_SESSION = "zs_session";
const KEY_USERID = "zs_userid";
const KEY_TIME = "zs_capture_time";

// Argument 解析（兼容对象 / 逗号分隔字符串两种形态）
const ARGS = (function () {
    if (!$argument) return {};
    if (typeof $argument === "string") return { debug: $argument.split(",")[0] === "true" };
    if ($argument[0] !== undefined) return { debug: $argument[0] === "true" };
    return { debug: $argument.DEBUG === true || $argument.DEBUG === "true" };
})();

(function () {
    const headers = $request.headers;
    // header 名大小写不敏感处理
    const h = {};
    for (const k in headers) h[k.toLowerCase()] = headers[k];

    const session = h["third-session"];
    if (!session) { $done({}); return; }

    // 从 URL 提取 userId（部分请求可能不带）
    let userId = null;
    const m = ($request.url || "").match(/userId=(\d+)/);
    if (m) userId = m[1];

    const oldSession = $persistentStore.read(KEY_SESSION);
    const oldUser = $persistentStore.read(KEY_USERID);
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

    const sessionChanged = session !== oldSession;
    const userChanged = userId && userId !== oldUser;

    if (sessionChanged || userChanged) {
        $persistentStore.write(session, KEY_SESSION);
        if (userId) $persistentStore.write(userId, KEY_USERID);
        $persistentStore.write(now, KEY_TIME);
        console.log("[zs-signin] 捕获新 session: " + session.substring(0, 8) + "... userId: " + (userId || oldUser || "未知"));
        $notification.post("签到凭证已更新", "session 已自动续期", "时间: " + now, "");
    } else {
        if (ARGS.debug) console.log("[zs-signin] session 未变化，跳过写入");
    }

    $done({});
})();