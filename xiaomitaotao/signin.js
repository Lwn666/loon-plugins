/*
 * 小米淘淘小程序自动签到脚本 (cron 通用)
 * 域名: zsvip.xomitoto.com
 * 凭证来源: $persistentStore（由 capture.js 在打开小程序时自动捕获 third-session）
 * 流程: 读 session → 查今日状态 → 未签则 POST 签到 → 推送结果
*/

const HOST = "https://zsvip.xomitoto.com";
const APP_ID = "wx61895974f3c540d6";
const SIGNIN_ACTION_PATH = "/mall/api/ma/signin/save";

const KEY_SESSION = "zs_session";
const KEY_TIME = "zs_capture_time";

const ARGS = (function () {
    if (!$argument) return {};
    if (typeof $argument === "string") return { debug: $argument.split(",")[0] === "true" };
    if ($argument[0] !== undefined) return { debug: $argument[0] === "true" };
    return { debug: $argument.DEBUG === true || $argument.DEBUG === "true" };
})();

function buildHeaders(session) {
    return {
        "app-id": APP_ID,
        "third-session": session,
        "content-type": "application/json",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.76(0x18004c26) NetType/4G Language/zh_CN",
        "Referer": "https://servicewechat.com/" + APP_ID + "/page-frame.html"
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
    const capTime = $persistentStore.read(KEY_TIME);

    if (!session) {
        notify("凭证未就绪", "缺少 session",
            "请先用微信打开一次小米淘淘小程序任意页面，再重试签到");
        return finish();
    }

    console.log("session: " + session.substring(0, 8) + "..." +
        (capTime ? " (捕获于 " + capTime + ")" : ""));
    debugLog("DEBUG 模式已开启");

    // 第一步：查询今日签到状态（无需 userId 参数）
    req({
        url: HOST + "/mall/api/ma/signin/getSignInInfo",
        headers: buildHeaders(session),
        timeout: 15000
    }, function (err, resp, data) {
        if (err) { notify("签到失败", "网络错误", String(err)); return finish(); }

        let info;
        try { info = JSON.parse(data); } catch (e) {
            notify("签到失败", "响应异常", String(data).substring(0, 100));
            return finish();
        }

        if (info.code !== 0) {
            notify("⚠️ 凭证已失效", "code: " + info.code, "请打开小米淘淘小程序任意页面刷新 session 后重试");
            return finish();
        }

        const d = info.data || {};
        if (d.todayIsSignIn === true) {
            notify("今日已签到 ✅", "连续 " + (d.continuousDays || "?") + " 天", "无需重复签到");
            return finish();
        }

        // 第二步：执行签到动作
        $httpClient.post({
            url: HOST + SIGNIN_ACTION_PATH,
            headers: buildHeaders(session),
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
                req({
                    url: HOST + "/mall/api/ma/signin/getSignInInfo",
                    headers: buildHeaders(session),
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