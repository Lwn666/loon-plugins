/*
 * 小米淘淘小程序自动签到脚本 (cron 通用)
 * 域名: zsvip.xomitoto.com
 *
 * 凭证来源: $persistentStore（由 capture.js 在打开小程序时自动更新）
 * 流程: 读凭证 → 查今日状态 → 未签则执行签到 → 通知结果
*/

const HOST = "https://zsvip.xomitoto.com";
// 签到动作接口（已从完整抓包确认）
const SIGNIN_ACTION_PATH = "/mall/api/ma/signin/save";

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

function buildHeaders(appId, session) {
    return {
        "app-id": appId,
        "third-session": session,
        "content-type": "application/json",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.76(0x18004c26) NetType/4G Language/zh_CN",
        "Referer": "https://servicewechat.com/" + appId + "/page-frame.html"
    };
}

function req(options, cb) {
    $httpClient.get(options, cb);
}

function notify(title, sub, body) {
    console.log("[" + title + "] " + sub + " | " + body);
    $notification.post(title, sub, body);
}

function debugLog(msg) {
    if (ARGS.debug) console.log("[debug] " + msg);
}

function finish() { $done(); }

(function () {
    const session = $persistentStore.read(KEY_SESSION);
    const userId = $persistentStore.read(KEY_USERID);
    const appId = $persistentStore.read(KEY_APPID);
    const capTime = $persistentStore.read(KEY_TIME);

    // 凭证完整性检查：全部来自 capture.js 捕获，缺一则提示先开小程序
    if (!session || !userId || !appId) {
        notify("凭证未就绪", "缺少 " + (!appId ? "app-id" : !session ? "session" : "userId"),
            "请先用微信打开一次小米淘淘小程序任意页面，再重试签到");
        return finish();
    }

    console.log("session: " + session.substring(0, 8) + "... userId: " + userId +
        (capTime ? " (捕获于 " + capTime + ")" : ""));
    debugLog("DEBUG 模式已开启");

    // 第一步：查询今日签到状态
    req({
        url: HOST + "/mall/api/ma/signin/getSignInInfo?userId=" + userId,
        headers: buildHeaders(appId, session),
        timeout: 15000
    }, function (err, resp, data) {
        if (err) { notify("签到失败", "网络错误", String(err)); return finish(); }

        let info;
        try { info = JSON.parse(data); } catch (e) {
            notify("签到失败", "响应异常", String(data).substring(0, 100));
            return finish();
        }

        // 会话过期检测：非 0 code 视为凭证失效
        if (info.code !== 0) {
            notify("⚠️ 凭证已失效", "code: " + info.code, "请打开小米淘淘小程序任意页面刷新 session 后重试");
            return finish();
        }

        const d = info.data || {};
        if (d.todayIsSignIn === true) {
            notify("今日已签到 ✅", "连续 " + (d.continuousDays || "?") + " 天", "无需重复签到");
            return finish();
        }

        // 第二步：执行签到动作（POST /signin/save，body 为字面量 null）
        $httpClient.post({
            url: HOST + SIGNIN_ACTION_PATH,
            headers: buildHeaders(appId, session),
            body: "null",
            timeout: 15000
        }, function (err2, resp2, data2) {
            if (err2) { notify("签到失败", "网络错误", String(err2)); return finish(); }

            let res;
            try { res = JSON.parse(data2); } catch (e) {
                notify("签到失败", "响应异常", String(data2).substring(0, 100));
                return finish();
            }

            if (res.code === 0 && res.ok === true) {
                // 签到成功后再查一次状态拿连续天数
                req({
                    url: HOST + "/mall/api/ma/signin/getSignInInfo",
                    headers: buildHeaders(appId, session),
                    timeout: 15000
                }, function (err3, resp3, data3) {
                    let days = "?";
                    try {
                        const info = JSON.parse(data3);
                        if (info.code === 0 && info.data) days = info.data.continuousDays || "?";
                    } catch (e) {}
                    notify("签到成功 🎉", "积分 +20", "已连续签到 " + days + " 天");
                    finish();
                });
            } else if (res.code !== 0) {
                notify("签到失败", "code: " + res.code, res.msg || "");
                finish();
            } else {
                notify("签到结果未知", "", String(data2).substring(0, 120));
                finish();
            }
        });
    });
})();