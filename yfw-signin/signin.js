/*
 * 药房网自动签到脚本 (cron 通用)
 * 域名: m.yaofangwang.com
 * 凭证来源: $persistentStore（由 capture.js 捕获 ASP.NET_SessionId）
 * 流程: 读 SessionId → 拉签到页提取 accountid → GET /customer/SignNew?accountid=xxx → 推送结果
 *
 * 修复记录 (2026-08-27):
 * - 原脚本请求 SignNew 不带 accountid，服务端按匿名处理，signalltime/weeksigntime 恒为 1
 * - 现在先 GET /customer/sign_ios.html 提取 accountid（页面 JS 里 accountid:xxx），再带参签到
*/

const HOST = "https://m.yaofangwang.com";
const SIGN_PATH = "/customer/sign_ios.html";
const SIGNIN_PATH = "/customer/SignNew";

const KEY_COOKIE = "yfw_cookie";
const KEY_TIME = "yfw_capture_time";
const KEY_ACCOUNT = "yfw_accountid";

const ARGS = (function () {
    if (!$argument) return {};
    if (typeof $argument === "string") return { debug: $argument.split(",")[0] === "true" };
    if ($argument[0] !== undefined) return { debug: $argument[0] === "true" };
    return { debug: $argument.DEBUG === true || $argument.DEBUG === "true" };
})();

function buildHeaders(sessionId) {
    return {
        "Host": "m.yaofangwang.com",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Language": "zh-SG,zh-CN;q=0.9,zh-Hans;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        "Referer": "https://m.yaofangwang.com/customer/sign_ios.html?source=iosapp",
        "Cookie": sessionId,
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

// 从签到页 HTML 提取 accountid（页面 JS: data: { accountid:5572702}）
function extractAccountId(html) {
    if (!html) return null;
    // 匹配 accountid:5572702 或 accountid: 5572702 或 accountid=5572702
    var m = html.match(/accountid\s*[:=]\s*["']?(\d+)/);
    if (m) return m[1];
    // 兜底：搜索任意 accountid 数字
    m = html.match(/accountid[^0-9]{0,10}(\d{4,})/);
    return m ? m[1] : null;
}

(function () {
    const sessionId = $persistentStore.read(KEY_COOKIE);
    const capTime = $persistentStore.read(KEY_TIME);

    if (!sessionId) {
        notify("凭证未就绪", "缺少 ASP.NET_SessionId",
            "请先用药房网 App/H5 打开签到页面，再重试签到");
        return finish();
    }

    console.log("SessionId: " + sessionId.substring(0, 32) + "..." +
        (capTime ? " (捕获于 " + capTime + ")" : ""));
    debugLog("DEBUG 模式已开启");

    // 读取缓存的 accountid（优先），没有则拉页面提取
    const cachedAccount = $persistentStore.read(KEY_ACCOUNT);
    debugLog("缓存的 accountid: " + (cachedAccount || "无"));

    function doSign(accountId) {
        const url = HOST + SIGNIN_PATH + "?accountid=" + accountId + "&_=" + Date.now();
        debugLog("签到 URL: " + url);
        req({ url: url, headers: buildHeaders(sessionId), timeout: 15000 }, function (err, resp, data) {
            if (err) { notify("签到失败", "网络错误", String(err)); return finish(); }

            let info;
            try { info = JSON.parse(data); } catch (e) {
                notify("签到失败", "响应异常", String(data).substring(0, 100));
                return finish();
            }

            // code: 1=签到成功, -1=已签到(正常), 其他=失败/凭证失效
            if (info.code === -1 && info.msg && info.msg.includes("已签到")) {
                notify("今日已签到 ✅", "无需重复签到", info.msg);
                return finish();
            }
            if (info.code !== 1) {
                notify("⚠️ 签到失败/凭证失效", "code: " + info.code, info.msg || "请重新打开签到页面刷新 SessionId");
                return finish();
            }

            const r = info.result || {};
            const pointNum = r.point_num || 0;
            // signalltime = 连续签到天数（每周一重置），非累计
            const signAllTime = r.signalltime || 0;
            const weekSignTime = r.weeksigntime || 0;

            notify("药房网签到成功 🎉", "获得 " + pointNum + " 积分", "连续签到 " + signAllTime + " 天，本周第 " + weekSignTime + " 天");
            finish();
        });
    }

    if (cachedAccount) {
        return doSign(cachedAccount);
    }

    // 无缓存 accountid → 拉签到页提取
    debugLog("拉取签到页提取 accountid: " + HOST + SIGN_PATH);
    req({ url: HOST + SIGN_PATH + "?_=" + Date.now(), headers: buildHeaders(sessionId), timeout: 15000 }, function (err, resp, data) {
        if (err) { notify("签到失败", "拉取签到页失败", String(err)); return finish(); }
        const html = typeof data === "string" ? data : String(data || "");
        const accountId = extractAccountId(html);
        debugLog("页面提取 accountid: " + (accountId || "未找到"));

        if (!accountId) {
            // 提取失败，退回到不带 accountid（保持原行为，至少能签到）
            debugLog("未提取到 accountid，退回无参签到");
            return doSign("");
        }

        // 缓存 accountid
        try { $persistentStore.write(accountId, KEY_ACCOUNT); } catch (e) {}
        return doSign(accountId);
    });
})();
