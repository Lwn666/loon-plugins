/*
 * 药房网自动签到脚本 (cron 通用)
 * 域名: m.yaofangwang.com
 * 凭证来源: $persistentStore（由 capture.js 在打开签到页时自动捕获 token/Cookie/accountId）
 * 流程: 读凭证 → GET /customer/SignNew → 推送结果
*/

const HOST = "https://m.yaofangwang.com";
const SIGNIN_PATH = "/customer/SignNew";

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

function buildHeaders(token, cookie, accountId) {
    const ts = Date.now();
    return {
        "Host": "m.yaofangwang.com",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Language": "zh-SG,zh-CN;q=0.9,zh-Hans;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        "Referer": "https://m.yaofangwang.com/customer/sign_ios.html?source=iosapp",
        "Cookie": cookie,
        "Connection": "keep-alive"
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
    const token = $persistentStore.read(KEY_TOKEN);
    const cookie = $persistentStore.read(KEY_COOKIE);
    const accountId = $persistentStore.read(KEY_ACCOUNTID);
    const capTime = $persistentStore.read(KEY_TIME);

    if (!token || !cookie || !accountId) {
        notify("凭证未就绪", "缺少 " + (!token ? "token" : !cookie ? "Cookie" : "accountId"),
            "请先用药房网 App/H5 打开签到页面，再重试签到");
        return finish();
    }

    console.log("token: " + token.substring(0, 16) + "... accountId: " + accountId +
        (capTime ? " (捕获于 " + capTime + ")" : ""));
    debugLog("DEBUG 模式已开启");

    // 执行签到
    req({
        url: HOST + SIGNIN_PATH + "?accountid=" + accountId + "&_=" + Date.now(),
        headers: buildHeaders(token, cookie, accountId),
        timeout: 15000
    }, function (err, resp, data) {
        if (err) { notify("签到失败", "网络错误", String(err)); return finish(); }

        let info;
        try { info = JSON.parse(data); } catch (e) {
            notify("签到失败", "响应异常", String(data).substring(0, 100));
            return finish();
        }

        if (info.code !== 1) {
            notify("⚠️ 签到失败/凭证失效", "code: " + info.code, info.msg || "请重新打开签到页面刷新凭证");
            return finish();
        }

        const r = info.result || {};
        const pointNum = r.point_num || 0;
        const signAllTime = r.signalltime || 0;
        const weekSignTime = r.weeksigntime || 0;

        notify("药房网签到成功 🎉", "获得 " + pointNum + " 积分", "累计签到 " + signAllTime + " 天，本周第 " + weekSignTime + " 天");
        finish();
    });
})();