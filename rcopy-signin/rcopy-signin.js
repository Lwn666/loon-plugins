/**
 * Rcopy 签到（cron 定时执行）
 * 凭证优先级：$persistentStore（插件自动捕获） → 插件参数 phone/token
 */
var URL_SIGNIN = "https://rcopy.nikola-lab.cn/server2/thinkphp/public/index.php/api/Newsignin/SignIn";
var UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.56(0x1800382e) NetType/WIFI Language/zh_CN";
var REFERER = "https://servicewechat.com/wx74846d51d020b58f/113/page-frame.html";
var KEY_PHONE = "rcopy_phone";
var KEY_TOKEN = "rcopy_token";
var KEY_CAPTURE = "rcopy_capture_time";
var TAG = "[Rcopy签到]";

function log(m) { console.log(TAG + " " + m); }

function readStore(k) {
  try { var v = $persistentStore.read(k); return v ? String(v) : ""; } catch (e) { return ""; }
}

function readArgRaw(name) {
  try {
    if (typeof $argument !== "undefined" && $argument !== null && $argument !== "") {
      var arg = $argument;
      if (typeof arg === "string") { try { arg = JSON.parse(arg); } catch (e) { return ""; } }
      if (arg && typeof arg === "object" && !Array.isArray(arg)) {
        if (arg[name] !== undefined) return String(arg[name]);
        for (var k in arg) {
          if (String(k).toLowerCase() === String(name).toLowerCase()) return String(arg[k]);
        }
      }
    }
  } catch (e) {}
  return "";
}

function getEnv(name) { return readStore(name) || readArgRaw(name); }

function isDebug() {
  var d = getEnv("debug");
  return !(d === "" || d === "false" || d === "0");
}

function validToken(t) {
  if (!t || String(t).length < 40) return false;
  return String(t).split(".").length === 3;
}

function tokenExp(t) {
  try {
    var p = String(t).split(".")[1];
    p = p.replace(/-/g, "+").replace(/_/g, "/");
    while (p.length % 4 !== 0) p += "=";
    var raw = base64Decode(p);
    var m = raw.match(/"exp"\s*:\s*(\d+)/);
    if (m) return parseInt(m[1], 10) * 1000;
  } catch (e) {}
  return 0;
}

function base64Decode(b64) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = new Array(256);
  for (var i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  b64 = String(b64).replace(/[\r\n\s]+/g, "").replace(/=+$/, "");
  var out = [], buffer = 0, bits = 0;
  for (var j = 0; j < b64.length; j++) {
    var val = lookup[b64.charCodeAt(j)];
    if (val === undefined) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
  }
  var s = "";
  for (var k = 0; k < out.length; k++) s += String.fromCharCode(out[k]);
  return s;
}

function normalizeBody(body) {
  if (typeof body === "string") return body;
  if (body && typeof body.length === "number") {
    var s = "";
    for (var i = 0; i < body.length; i++) s += String.fromCharCode(body[i]);
    return s;
  }
  return String(body || "");
}

function main() {
  var phone = readStore(KEY_PHONE) || getEnv("phone");
  var token = readStore(KEY_TOKEN) || getEnv("token");

  log("#### Rcopy 签到开始");
  var captureAt = readStore(KEY_CAPTURE);
  if (captureAt) {
    var mins = Math.round((Date.now() - parseInt(captureAt, 10)) / 60000);
    log("- 凭证捕获于 " + mins + " 分钟前");
  } else {
    log("- 凭证来源: " + (token ? "插件参数" : "无"));
  }

  if (!validToken(token) || !phone) {
    log("- ❌ 缺少有效凭证（phone=" + (phone || "空") + "）");
    $notification.post("⚠️ Rcopy 签到", "缺少凭证", "请打开 Rcopy 小程序任意页面，凭证会自动捕获");
    $done();
    return;
  }

  var exp = tokenExp(token);
  if (exp && exp < Date.now()) {
    log("- ❌ token 已过期（" + new Date(exp).toLocaleString() + "）");
    $notification.post("⚠️ Rcopy 签到", "token 已过期", "打开 Rcopy 小程序刷新凭证后重试");
    $done();
    return;
  }
  if (exp) log("- token 有效期至 " + new Date(exp).toLocaleString());

  var body = JSON.stringify({ phone: phone, token: token, system_type: "WeChat:ios" });
  log("- 签到中...");

  $httpClient.post({
    url: URL_SIGNIN,
    timeout: 15000,
    headers: {
      "content-type": "application/json",
      "User-Agent": UA,
      "Referer": REFERER
    },
    body: body
  }, function (err, resp, data) {
    if (err) {
      log("- ❌ 请求失败: " + err);
      $notification.post("⚠️ Rcopy 签到", "请求失败", String(err));
      $done();
      return;
    }
    var status = resp ? resp.status : 0;
    var text = normalizeBody(data).trim();
    log("- HTTP " + status);
    if (isDebug() && resp && resp.headers) log("- 响应头: " + JSON.stringify(resp.headers));
    log("- 响应: " + (text.length > 200 ? text.substring(0, 200) + "..." : text));

    var ok = false, msg = text, expired = false;
    try {
      var j = JSON.parse(text);
      msg = j.msg || j.message || j.info || text;
      var code = j.code !== undefined ? j.code : j.status;
      ok = (code === 0 || code === 1 || code === 200 || code === "0" || code === "1" || code === "200");
    } catch (e) {
      // 服务端实际返回纯文本（实测错误响应 "token已经过期"）
      var FAIL_RE = /(过期|失效|失败|异常|错误|非法|重新登录|请登录)/;
      ok = !FAIL_RE.test(text) && /(成功|已签到|已经签到|重复签到|完成)/.test(text);
    }
    if (/过期|失效|未登录|重新登录|请登录/.test(msg)) expired = true;

    log("- " + (ok ? "✅ " : "❌ ") + msg);
    if (expired) {
      $notification.post("⚠️ Rcopy 签到", "凭证已失效", msg + "\n打开 Rcopy 小程序任意页面即可自动刷新凭证");
    } else {
      $notification.post(ok ? "Rcopy 签到" : "⚠️ Rcopy 签到",
        ok ? "签到成功 ✓" : "签到失败",
        msg + "\n手机号 " + phone);
    }
    $done();
  });
}

try { main(); } catch (e) {
  log("异常: " + e);
  log("堆栈: " + (e.stack || "无"));
  $done();
}
