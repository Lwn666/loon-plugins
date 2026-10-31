/*
 * Readify 阅读 7 天挑战每日签到
 * ------------------------------------------------------------------
 * 接口（抓包实测 2026-10-31）：
 *   查询：GET  https://readifyapp.voiceclub.cn/api/campaigns/streaks/status?campaignId=<ID>
 *   签到：POST https://readifyapp.voiceclub.cn/api/campaigns/streaks
 *         body {"campaignId":"<ID>"}
 * 认证：请求头 x-token（JWT，约 73h 过期）+ x-user-id + x-device-id + 固定头。
 *       凭证由 readify-capture.js 打开 App 时自动抓取，存 $persistentStore。
 *
 * 响应字段（code=0 成功）：
 *   activityStatus ACTIVE / ...    活动状态
 *   roundStatus    DAY1_READY / IN_PROGRESS / ...  当前轮状态
 *   currentDay     已连续签到天数（未签为 0）
 *   streakedToday  true=今日已签
 *   canCheckIn     true=今日可签
 *   checkInResult  CHECKED_IN（签到后返回）
 * ------------------------------------------------------------------
 */

var STORE = {
  token: "readify_token",
  userId: "readify_user_id",
  deviceId: "readify_device_id",
  lang: "readify_lang",
  os: "readify_os",
  tz: "readify_time_zone",
  clientRegion: "readify_client_region",
  sysRegion: "readify_client_sys_region",
  userAgent: "readify_user_agent",
  appName: "readify_app_name",
  time: "readify_capture_time"
};

var BASE = "https://readifyapp.voiceclub.cn";
var DEFAULT_CAMPAIGN = "reading-streak-7d-202607";
var TITLE = "Readify 签到";
var TIMEOUT = 15000;   // $httpClient timeout 单位是毫秒

/* ---------- 参数 / 存储读取 ---------- */
var P = null;
try {
  if (typeof $argument === "object" && $argument) P = $argument;
  else if (typeof $argument === "string" && $argument) { try { P = JSON.parse($argument); } catch (e) { P = null; } }
} catch (e) { P = null; }
if (!P) P = {};

function arg(k) {
  if (P[k] !== undefined && P[k] !== null && String(P[k]) !== "") return String(P[k]).trim();
  try { return String($persistentStore.read(k) || "").trim(); } catch (e) { return ""; }
}
function flag(k) { return /^(true|1|on|yes)$/i.test(arg(k)); }
function readStore(k) {
  try { var v = $persistentStore.read(k); return v ? String(v) : ""; } catch (e) { return ""; }
}

var DEBUG = flag("DEBUG");
function log(s) { console.log("[Readify] " + s); }

/* ---------- 响应解码（Loon 可能把 body 当字节数组） ---------- */
function toStr(b) {
  if (b == null) return "";
  if (typeof b === "string") return b;
  var arr = null;
  if (b instanceof ArrayBuffer) arr = Array.prototype.slice.call(new Uint8Array(b));
  else if (typeof b === "object" && typeof b.length === "number") arr = Array.prototype.slice.call(b);
  else if (typeof b === "object") {
    var ks = Object.keys(b).filter(function (x) { return /^\d+$/.test(x); }).map(Number).sort(function (a, c) { return a - c; });
    if (ks.length) arr = ks.map(function (i) { return b[i]; });
  }
  if (!arr) return String(b);
  var s = "";
  for (var i = 0; i < arr.length; i++) { var n = arr[i] & 0xff; if (n >= 32 || n === 9 || n === 10 || n === 13) s += String.fromCharCode(n); }
  return s;
}
function cut(s) { var a = s.indexOf("{"), z = s.lastIndexOf("}"); return a >= 0 && z > a ? s.slice(a, z + 1) : s; }
function json(b) { try { return JSON.parse(cut(toStr(b))); } catch (e) { return null; } }

/* ---------- 请求 ---------- */
function req(method, path, body, cb, left) {
  var tries = left === undefined ? 1 : left;
  var opts = {
    url: BASE + path,
    timeout: TIMEOUT,
    headers: buildHeaders(),
    body: body || undefined
  };
  var back = function (err, resp, raw) {
    if (err && tries > 0) {
      log("请求失败（" + err + "），1 秒后重试");
      return setTimeout(function () { req(method, path, body, cb, tries - 1); }, 1000);
    }
    cb(err, resp, raw);
  };
  if (method === "POST") $httpClient.post(opts, back); else $httpClient.get(opts, back);
}

function buildHeaders() {
  var h = {
    "x-app-name": readStore(STORE.appName) || "readifyai",
    "x-client-region": readStore(STORE.clientRegion) || "CN",
    "x-client-sys-region": readStore(STORE.sysRegion) || "SG",
    "x-lang": readStore(STORE.lang) || "zh-Hans",
    "x-os": readStore(STORE.os) || "16.6.1",
    "x-user-agent": "iOS/3.6.2",
    "x-v": "v1",
    "x-time-zone": readStore(STORE.tz) || "Asia/Hong_Kong",
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": readStore(STORE.userAgent) || "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) readify version/3.6.2 platform/ios"
  };
  var tok = readStore(STORE.token), uid = readStore(STORE.userId), did = readStore(STORE.deviceId);
  if (tok) h["x-token"] = tok;
  if (uid) h["x-user-id"] = uid;
  if (did) h["x-device-id"] = did;
  return h;
}

/* 认证失效判定：服务端对坏/过期 token 返回 HTTP 200 + code=200000 "Invalid user token"（不是 401/403） */
function isAuthError(d, status) {
  if (status === 401 || status === 403) return true;
  if (!d) return false;
  var msg = String(d.message || "");
  return /token|unauthor|forbidden|登录|失效|授权|认证|expired/i.test(msg);
}

/* ---------- 本地 JWT 过期判断（exp 秒） ---------- */
function tokenExpired() {
  var t = readStore(STORE.token);
  if (!t) return true;
  var parts = t.split(".");
  if (parts.length !== 3) return true;
  try {
    var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (typeof payload.exp === "number") {
      return (payload.exp * 1000) < Date.now();
    }
    return false;
  } catch (e) { return false; }
}

function notify(sub, msg) {
  $notification.post(TITLE, sub, msg);
  console.log(TITLE + " - " + sub + ": " + msg);
  try { $done(); } catch (e) {}
}

/* ---------- 主流程 ---------- */
(function main() {
  var campaignId = arg("CAMPAIGN_ID") || DEFAULT_CAMPAIGN;

  if (DEBUG) log("campaignId=" + campaignId + " token=" + (readStore(STORE.token) ? "有(" + readStore(STORE.token).slice(0, 16) + "…)" : "无") + " uid=" + (readStore(STORE.userId) || "-"));

  if (!readStore(STORE.token)) {
    return notify("⚠️ 缺少凭证", "未捕获到 x-token\n请打开一次 Readify App 刷新凭证");
  }
  if (tokenExpired()) {
    return notify("🔑 凭证已过期", "token 已过期（约 3 天有效期）\n请重新打开 Readify App 刷新");
  }

  log("#### 查询签到状态");
  req("GET", "/api/campaigns/streaks/status?campaignId=" + encodeURIComponent(campaignId), null, function (err, resp, raw) {
    if (err || !resp) return notify("❌ 网络错误", "查询状态失败：" + (err && err.message ? err.message : String(err)));

    var status = resp.status || 0;
    var d = json(raw);
    if (DEBUG) log("status HTTP " + status + " body=" + cut(toStr(raw)).slice(0, 300));

    if (status === 401 || status === 403 || (d && d.code !== 0 && isAuthError(d, status))) {
      return notify("🔑 凭证失效", "服务端返回：「" + ((d && d.message) || ("HTTP " + status)) + "」\n请重新打开 Readify App 刷新 token");
    }
    if (!d || d.code !== 0) {
      return notify("⚠️ 查询异常", (d && d.message) || ("HTTP " + status + " " + cut(toStr(raw)).slice(0, 100)));
    }

    var data = d.data || {};
    var activity = data.activityStatus || "";
    var round = data.roundStatus || "";
    var streakedToday = data.streakedToday === true;
    var canCheckIn = data.canCheckIn === true;
    var currentDay = (typeof data.currentDay === "number") ? data.currentDay : 0;

    log("- 活动状态: " + activity);
    log("- 本轮状态: " + round);
    log("- 已连续签到: " + currentDay + " 天");
    log("- 今日已签: " + streakedToday + " / 今日可签: " + canCheckIn);

    if (streakedToday) {
      return notify("✅ 今日已签到", "第 " + currentDay + " 天已完成\n无需重复操作");
    }
    if (activity !== "ACTIVE") {
      return notify("⏸️ 活动未进行", "活动状态：" + activity + "\n今日不可签到");
    }
    if (!canCheckIn) {
      return notify("ℹ️ 今日不可签到", "活动状态 " + activity + " / " + round + "\n可能已中断或需明日再来");
    }

    log("#### 执行签到");
    req("POST", "/api/campaigns/streaks", JSON.stringify({ campaignId: campaignId }), function (err2, resp2, raw2) {
      if (err2 || !resp2) return notify("❌ 网络错误", "签到失败：" + (err2 && err2.message ? err2.message : String(err2)));

      var st2 = resp2.status || 0;
      var d2 = json(raw2);
      if (DEBUG) log("签到 HTTP " + st2 + " body=" + cut(toStr(raw2)).slice(0, 300));

      if (st2 === 401 || st2 === 403 || (d2 && d2.code !== 0 && isAuthError(d2, st2))) {
        return notify("🔑 凭证失效", "签到被拒：「" + ((d2 && d2.message) || ("HTTP " + st2)) + "」\n请重新打开 Readify App 刷新 token");
      }
      if (!d2 || d2.code !== 0) {
        return notify("❌ 签到失败", (d2 && d2.message) || ("HTTP " + st2 + " " + cut(toStr(raw2)).slice(0, 120)));
      }

      var data2 = d2.data || {};
      var result = data2.checkInResult || "";
      var day = (typeof data2.currentDay === "number") ? data2.currentDay : 0;

      if (result === "CHECKED_IN" || data2.streakedToday === true) {
        return notify("✅ 签到成功", "7 天挑战第 " + day + " 天\n连续 " + day + " 天达成");
      }
      return notify("⚠️ 签到结果未知", "checkInResult=" + (result || "-") + "\n" + cut(toStr(raw2)).slice(0, 120));
    });
  });
})();
