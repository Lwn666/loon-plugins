/*
 * Readify 阅读 7 天挑战：每日签到 + 本轮奖励领取
 * ------------------------------------------------------------------
 * 接口（抓包实测 2026-11-27）：
 *   状态：GET  /api/campaigns/streaks/status?campaignId=<ID>
 *   签到：POST /api/campaigns/streaks          body {"campaignId":"<ID>"}
 *         → data.checkInResult = "CHECKED_IN"
 *   领奖：POST /api/campaigns/streaks/reward-claims   body {"campaignId":"<ID>"}
 *         → data.claimResult = "CLAIMED"，rewardType/rewardCount/ultraHdDays/claimedAt/nextAvailableAt
 *   认证：请求头 x-token（JWT，实测 7.33 天有效）+ x-user-id + x-device-id + 固定头。
 *         凭证由 readify-capture.js 打开 App/网页时自动抓取，存 $persistentStore。
 *
 * 状态字段（code=0 成功）：
 *   activityStatus  ACTIVE / ...
 *   roundStatus     DAY1_READY / IN_PROGRESS / CLAIMABLE（可领奖）/ CLAIMED_WAITING（已领，等下一轮）
 *   currentDay      已连续签到天数
 *   streakedToday   true=今日已签
 *   canCheckIn      true=今日可签
 *   canClaim        true=本轮奖励可领
 *   claimedAt / rewardCount / ultraHdDays / nextAvailableAt   领奖后回填
 *
 * 流程：查状态 → 可签到则签到 → 重查状态 → 可领奖则领奖 → 一条推送汇报。
 *       领奖是状态变更请求：不自动重试；结果不明时只做只读回查，不重复提交。
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
  time: "readify_capture_time",
  lastClaim: "readify_last_claim"
};

var BASE = "https://readifyapp.voiceclub.cn";
var DEFAULT_CAMPAIGN = "reading-streak-7d-202607";
var TITLE = "Readify 签到";
var TIMEOUT = 15000;   // $httpClient timeout 单位是毫秒

var TZ_OFF = { "Asia/Hong_Kong": 8, "Asia/Shanghai": 8, "Asia/Singapore": 8, "Asia/Taipei": 8, "Asia/Tokyo": 9, "UTC": 0 };

/* ---------- 参数 / 存储读取 ---------- */
var P = null;
try {
  if (typeof $argument === "object" && $argument) P = $argument;
  else if (typeof $argument === "string" && $argument) { try { P = JSON.parse($argument); } catch (e) { P = null; } }
} catch (e) { P = null; }
if (!P) P = {};

var POS = ["CAMPAIGN_ID", "DEBUG", "CLAIM_ENABLE"];   // 与 .plugin 里 script 的参数顺序一致

function arg(k) {
  if (P && typeof P === "object") {
    if (Object.prototype.toString.call(P) === "[object Array]") {
      var i = POS.indexOf(k);
      if (i >= 0 && P[i] !== undefined && P[i] !== null && String(P[i]) !== "") return String(P[i]).trim();
    } else if (P[k] !== undefined && P[k] !== null && String(P[k]) !== "") {
      return String(P[k]).trim();
    }
  }
  try { return String($persistentStore.read(k) || "").trim(); } catch (e) { return ""; }
}
function flag(k) { return /^(true|1|on|yes)$/i.test(arg(k)); }
function claimEnabled() { var v = arg("CLAIM_ENABLE"); return v === "" ? true : /^(true|1|on|yes)$/i.test(v); }
function readStore(k) {
  try { var v = $persistentStore.read(k); return v ? String(v) : ""; } catch (e) { return ""; }
}
function writeStore(k, v) {
  try { $persistentStore.write(String(v), k); return true; } catch (e) { return false; }
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
function pad(n) { return n < 10 ? "0" + n : String(n); }
function fmtTime(ms, tz) {
  if (!ms) return "";
  var off = TZ_OFF[tz];
  if (off === undefined) off = -(new Date().getTimezoneOffset()) / 60;
  var d = new Date(ms + off * 3600000);
  return pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
}
var REWARD_NAME = { VOICE_SEAT: "语音席位" };

/* 上次领奖的本地记录：状态接口不回 rewardType，用它补全文案 */
function savedClaim() {
  try {
    var r = JSON.parse(readStore(STORE.lastClaim) || "null");
    return (r && r.campaignId === R.campaignId) ? r : null;
  } catch (e) { return null; }
}

/* ---------- 请求 ---------- */
function req(method, path, body, cb, retries) {
  var left = (retries === undefined) ? 1 : retries;
  var opts = { url: BASE + path, timeout: TIMEOUT, headers: buildHeaders() };
  if (body) opts.body = body;
  var back = function (err, resp, raw) {
    if (err && left > 0) {
      log("请求失败（" + err + "），1 秒后重试");
      return setTimeout(function () { req(method, path, body, cb, left - 1); }, 1000);
    }
    cb(err || null, resp || null, raw);
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
    "x-user-agent": "iOS/3.6.5",
    "x-v": "v1",
    "x-time-zone": readStore(STORE.tz) || "Asia/Hong_Kong",
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": readStore(STORE.userAgent) || "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) readify version/3.6.5 platform/ios"
  };
  var tok = readStore(STORE.token), uid = readStore(STORE.userId), did = readStore(STORE.deviceId);
  if (tok) h["x-token"] = tok;
  if (uid) h["x-user-id"] = uid;
  if (did) h["x-device-id"] = did;
  return h;
}

/* 认证失效判定：坏/过期 token 返回 HTTP 200 + code=200000 "Invalid user token"（不是 401/403） */
function isAuthError(d, status) {
  if (status === 401 || status === 403) return true;
  if (!d) return false;
  return /token|unauthor|forbidden|登录|失效|授权|认证|expired/i.test(String(d.message || ""));
}

/* ---------- JWT 有效期 ---------- */
function tokenInfo() {
  var t = readStore(STORE.token);
  if (!t) return { has: false };
  var parts = t.split(".");
  if (parts.length !== 3) return { has: true, exp: 0 };
  try {
    var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var pd = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return { has: true, exp: typeof pd.exp === "number" ? pd.exp * 1000 : 0 };
  } catch (e) { return { has: true, exp: 0 }; }
}
function tokenExpired() {
  var t = tokenInfo();
  if (!t.has) return true;
  if (!t.exp) return false;             // 解不出 exp 就交给服务端裁决
  return t.exp < Date.now();
}

/* ---------- 本次运行结果汇总 ---------- */
var R = {
  campaignId: "",
  day: 0,
  checkin: "",        // "" | ok | error | unknown | auth
  checkinMsg: "",
  claim: "",          // "" | ok | done | error | unknown | auth
  claimMsg: "",
  claimedAt: 0,
  rewardType: "",
  rewardCount: null,
  ultraHdDays: null,
  nextAvailableAt: 0,
  tz: "",
  extra: []
};

function notify() {
  var sub = pickSub();
  var lines = [];
  if (R.day > 0) lines.push("连续签到：第 " + R.day + " 天");

  if (R.checkin === "error") lines.push("签到失败：" + R.checkinMsg);
  if (R.checkin === "unknown") lines.push("签到结果未知：" + R.checkinMsg);
  if (R.checkin === "auth") lines.push("签到被拒：" + R.checkinMsg);

  if (R.claim === "ok" || R.claim === "done") {
    if (!R.rewardType) {
      var sc = savedClaim();
      if (sc && sc.rewardType) R.rewardType = sc.rewardType;
      if ((R.rewardCount === null || R.rewardCount === undefined) && sc && sc.rewardCount !== undefined) R.rewardCount = sc.rewardCount;
      if (!R.ultraHdDays && sc && sc.ultraHdDays) R.ultraHdDays = sc.ultraHdDays;
    }
    var rn = REWARD_NAME[R.rewardType] || R.rewardType || "奖励";
    var amt = (R.rewardCount === null || R.rewardCount === undefined) ? "" : " ×" + R.rewardCount;
    var text = rn + amt;
    if (R.ultraHdDays) text += " + 超清 " + R.ultraHdDays + " 天";
    lines.push(R.claim === "ok" ? ("本轮奖励已领取：" + text) : ("本轮奖励：" + text + "（此前已领取）"));
    if (R.claimedAt) lines.push("领取时间：" + fmtTime(R.claimedAt, R.tz));
    if (R.nextAvailableAt) lines.push("下次可领：" + fmtTime(R.nextAvailableAt, R.tz) + "（" + (R.tz || "本地") + "）");
  }
  if (R.claim === "error") lines.push("领奖失败：" + R.claimMsg);
  if (R.claim === "unknown") lines.push("领奖结果未知：" + R.claimMsg + "\n（未重复提交，请在 App 内确认）");
  if (R.claim === "auth") lines.push("领奖被拒：" + R.claimMsg);

  if (!R.checkin && !R.claim) lines.push("今日无需操作");

  for (var i = 0; i < R.extra.length; i++) lines.push(R.extra[i]);

  var t = tokenInfo();
  if (t.has && t.exp) {
    var leftH = Math.round((t.exp - Date.now()) / 3600000);
    if (leftH <= 24 && leftH > 0) lines.push("⚠️ 凭证约 " + leftH + " 小时后过期，请打开 App 刷新");
  }

  if (R.checkin === "auth" || R.claim === "auth") lines.push("请重新打开 Readify App 刷新 token");

  var msg = lines.length ? lines.join("\n") : "运行完成";
  $notification.post(TITLE, sub, msg);
  console.log(TITLE + " - " + sub + ": " + msg);
  try { $done(); } catch (e) {}
}

function pickSub() {
  if (R.checkin === "auth" || R.claim === "auth") return "🔑 凭证失效";
  if (R.checkin === "error") return "❌ 签到失败";
  if (R.checkin === "ok" && R.claim === "ok") return "✅ 签到 + 领奖成功";
  if (R.checkin === "ok") return "✅ 签到成功";
  if (R.claim === "ok") return "🎁 奖励领取成功";
  if (R.claim === "unknown") return "⚠️ 领奖结果未知";
  if (R.claim === "error") return "⚠️ 领奖失败";
  if (R.checkin === "unknown") return "⚠️ 签到结果未知";
  if (R.claim === "done") return "✅ 今日已签到 · 奖励已领";
  return "✅ 今日已签到";
}

/* ---------- 状态查询 ---------- */
function fetchStatus(cb) {
  req("GET", "/api/campaigns/streaks/status?campaignId=" + encodeURIComponent(R.campaignId), null, function (err, resp, raw) {
    if (err || !resp) return cb({ net: (err && err.message) ? err.message : String(err || "无响应") });
    var st = resp.status || 0, d = json(raw);
    if (DEBUG) log("状态 HTTP " + st + " " + cut(toStr(raw)).slice(0, 400));
    if (st === 401 || st === 403 || (d && d.code !== 0 && isAuthError(d, st))) {
      return cb({ auth: (d && d.message) || ("HTTP " + st) });
    }
    if (!d || d.code !== 0) {
      return cb({ bad: (d && d.message) || ("HTTP " + st + " " + cut(toStr(raw)).slice(0, 120)) });
    }
    cb(null, d.data || {});
  });
}

/* ---------- 主流程 ---------- */
function main() {
  R.campaignId = arg("CAMPAIGN_ID") || DEFAULT_CAMPAIGN;

  if (DEBUG) log("campaign=" + R.campaignId + " token=" + (readStore(STORE.token) ? "有" : "无") + " uid=" + (readStore(STORE.userId) || "-"));

  if (!readStore(STORE.token)) {
    R.checkin = "auth"; R.checkinMsg = "未捕获到 x-token";
    return notify();
  }
  if (tokenExpired()) {
    R.checkin = "auth"; R.checkinMsg = "token 已过期（约 7 天有效期）";
    return notify();
  }

  log("#### 查询签到状态");
  fetchStatus(function (e, d) {
    if (e) {
      if (e.auth) { R.checkin = "auth"; R.checkinMsg = e.auth; return notify(); }
      R.checkin = "error"; R.checkinMsg = e.net ? ("网络错误：" + e.net) : e.bad;
      return notify();
    }
    afterStatus(d);
  });
}

function afterStatus(d) {
  R.day = typeof d.currentDay === "number" ? d.currentDay : 0;
  R.tz = d.timezone || "";
  if (d.claimedAt) R.claimedAt = d.claimedAt;
  if (d.rewardCount !== null && d.rewardCount !== undefined) R.rewardCount = d.rewardCount;
  if (d.ultraHdDays !== null && d.ultraHdDays !== undefined) R.ultraHdDays = d.ultraHdDays;
  if (d.nextAvailableAt) R.nextAvailableAt = d.nextAvailableAt;

  if (DEBUG) log("day=" + R.day + " round=" + d.roundStatus + " 已签=" + d.streakedToday + " 可签=" + d.canCheckIn + " 可领=" + d.canClaim);

  var active = d.activityStatus === "ACTIVE";
  var canCheckIn = active && d.canCheckIn === true && d.streakedToday !== true;

  if (!active) {
    R.extra.push("活动状态：" + (d.activityStatus || "-") + "（不可签到）");
    return afterCheckin(d);
  }
  if (!canCheckIn) {
    if (d.streakedToday !== true && d.canClaim !== true) {
      R.extra.push("今日不可签到：roundStatus=" + (d.roundStatus || "-") + "（可能中断或需明日再来）");
    }
    return afterCheckin(d);
  }

  log("#### 执行签到");
  req("POST", "/api/campaigns/streaks", JSON.stringify({ campaignId: R.campaignId }), function (err, resp, raw) {
    if (err || !resp) {
      R.checkin = "error";
      R.checkinMsg = "网络错误：" + ((err && err.message) ? err.message : String(err || "无响应"));
      return afterCheckin(d);
    }
    var st = resp.status || 0, dd = json(raw);
    if (DEBUG) log("签到 HTTP " + st + " " + cut(toStr(raw)).slice(0, 300));

    if (st === 401 || st === 403 || (dd && dd.code !== 0 && isAuthError(dd, st))) {
      R.checkin = "auth"; R.checkinMsg = (dd && dd.message) || ("HTTP " + st);
      return notify();
    }
    if (!dd || dd.code !== 0) {
      R.checkin = "error";
      R.checkinMsg = (dd && dd.message) || ("HTTP " + st + " " + cut(toStr(raw)).slice(0, 120));
      return afterCheckin(d);      // 签到失败也再看一眼有没有可领奖励
    }
    var data = dd.data || {};
    if (typeof data.currentDay === "number") R.day = data.currentDay;
    if (data.checkInResult === "CHECKED_IN" || data.streakedToday === true) {
      R.checkin = "ok";
      log("签到成功，第 " + R.day + " 天");
    } else {
      R.checkin = "unknown";
      R.checkinMsg = "checkInResult=" + (data.checkInResult || "-");
    }
    // 签到可能让本轮变成可领奖 → 重新拉状态（只读）
    fetchStatus(function (e2, d2) {
      if (e2 || !d2) {
        if (e2 && e2.auth) { R.claim = "auth"; R.claimMsg = e2.auth; return notify(); }
        R.extra.push("签到后状态复查失败，本轮未执行领奖");
        return notify();
      }
      afterStatus2(d2);
    });
  });
}

/* 签到后的状态：只更新领奖相关字段，不再走签到分支 */
function afterStatus2(d) {
  R.tz = d.timezone || R.tz;
  if (typeof d.currentDay === "number" && d.currentDay > R.day) R.day = d.currentDay;
  if (d.claimedAt) R.claimedAt = d.claimedAt;
  if (d.rewardCount !== null && d.rewardCount !== undefined) R.rewardCount = d.rewardCount;
  if (d.ultraHdDays !== null && d.ultraHdDays !== undefined) R.ultraHdDays = d.ultraHdDays;
  if (d.nextAvailableAt) R.nextAvailableAt = d.nextAvailableAt;
  doClaim(d);
}

function afterCheckin(d) {
  doClaim(d);
}

/* ---------- 领奖 ---------- */
function doClaim(d) {
  if (d.canClaim !== true) {
    if (d.claimedAt) {
      R.claim = "done";
      if (!R.rewardType && d.rewardType) R.rewardType = d.rewardType;
    } else if (d.canClaim === undefined) {
      R.extra.push("状态未返回 canClaim，跳过领奖判断");
    }
    return notify();
  }

  if (!claimEnabled()) {
    R.extra.push("领奖开关已关闭，本轮奖励未领取");
    return notify();
  }

  log("#### 领取本轮奖励");
  // 状态变更请求：retries=0，失败不自动重发
  req("POST", "/api/campaigns/streaks/reward-claims", JSON.stringify({ campaignId: R.campaignId }), function (err, resp, raw) {
    if (err || !resp) {
      R.claim = "unknown";
      R.claimMsg = "网络错误：" + ((err && err.message) ? err.message : String(err || "无响应"));
      return verifyClaim();
    }
    var st = resp.status || 0, dd = json(raw);
    if (DEBUG) log("领奖 HTTP " + st + " " + cut(toStr(raw)).slice(0, 300));

    if (st === 401 || st === 403 || (dd && dd.code !== 0 && isAuthError(dd, st))) {
      R.claim = "auth"; R.claimMsg = (dd && dd.message) || ("HTTP " + st);
      return notify();
    }
    if (!dd || dd.code !== 0) {
      R.claim = "error";
      R.claimMsg = (dd && dd.message) || ("HTTP " + st + " " + cut(toStr(raw)).slice(0, 120));
      return verifyClaim();       // 可能是「已领过」，只读回查确认，不重复提交
    }
    var data = dd.data || {};
    if (data.claimResult === "CLAIMED") {
      R.claim = "ok";
      if (data.rewardType) R.rewardType = data.rewardType;
      if (data.rewardCount !== null && data.rewardCount !== undefined) R.rewardCount = data.rewardCount;
      if (data.ultraHdDays) R.ultraHdDays = data.ultraHdDays;
      if (data.claimedAt) R.claimedAt = data.claimedAt;
      if (data.nextAvailableAt) R.nextAvailableAt = data.nextAvailableAt;
      writeStore(STORE.lastClaim, JSON.stringify({
        campaignId: R.campaignId, claimedAt: R.claimedAt, rewardType: R.rewardType,
        rewardCount: R.rewardCount, ultraHdDays: R.ultraHdDays, nextAvailableAt: R.nextAvailableAt
      }));
      log("领奖成功：" + R.rewardType + " ×" + R.rewardCount);
      return notify();
    }
    R.claim = "unknown";
    R.claimMsg = "claimResult=" + (data.claimResult || "-");
    verifyClaim();
  }, 0);
}

/* 结果不明时只做只读回查：服务端 claimedAt 有值且 canClaim 已关闭 → 视为已领 */
function verifyClaim() {
  log("#### 回查领奖结果（只读）");
  fetchStatus(function (e, d) {
    if (e || !d) {
      if (e && e.auth) { R.claim = "auth"; R.claimMsg = e.auth; }
      return notify();
    }
    if (d.claimedAt && d.canClaim !== true) {
      R.claim = "ok";
      R.claimMsg = "";
      if (d.rewardType) R.rewardType = d.rewardType;
      if (d.rewardCount !== null && d.rewardCount !== undefined) R.rewardCount = d.rewardCount;
      if (d.ultraHdDays) R.ultraHdDays = d.ultraHdDays;
      R.claimedAt = d.claimedAt;
      if (d.nextAvailableAt) R.nextAvailableAt = d.nextAvailableAt;
      R.extra.push("（以状态回查确认已领取）");
      return notify();
    }
    notify();
  });
}

try { main(); } catch (e) {
  console.log("[Readify] 异常: " + e);
  try { $notification.post(TITLE, "⚠️ 脚本异常", String(e)); } catch (x) {}
  try { $done(); } catch (x) {}
}
