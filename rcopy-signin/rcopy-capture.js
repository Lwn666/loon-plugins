/**
 * Rcopy 签到 — 凭证自动捕获（http-request）
 * 微信小程序 wx74846d51d020b58f 打开任意页面即触发，自动保存 phone + token。
 */
var KEY_PHONE = "rcopy_phone";
var KEY_TOKEN = "rcopy_token";
var KEY_TIME = "rcopy_capture_time";
var TAG = "[Rcopy捕获]";

function log(m) { console.log(TAG + " " + m); }

function readStore(k) {
  try {
    var v = $persistentStore.read(k);
    return v ? String(v) : "";
  } catch (e) { return ""; }
}

function writeStore(k, v) {
  try { $persistentStore.write(String(v), k); return true; } catch (e) { return false; }
}

function getEnv(name) {
  try {
    if (typeof $persistentStore !== "undefined") {
      var v = $persistentStore.read(name);
      if (v) return String(v);
    }
  } catch (e) {}
  try {
    if (typeof $argument !== "undefined" && $argument !== null && $argument !== "") {
      var arg = $argument;
      if (typeof arg === "string") { try { arg = JSON.parse(arg); } catch (e) {} }
      if (arg && typeof arg === "object") {
        if (Array.isArray(arg)) {
          var idxMap = { debug: 0, notice: 1 };
          if (idxMap[name] !== undefined && arg[idxMap[name]] !== undefined) return String(arg[idxMap[name]]);
        } else {
          if (arg[name] !== undefined) return String(arg[name]);
          for (var k in arg) {
            if (String(k).toLowerCase() === String(name).toLowerCase()) return String(arg[k]);
          }
        }
      }
    }
  } catch (e) {}
  return "";
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

function readArgJson(arg) {
  if (!arg) return null;
  if (typeof arg === "object") return arg;
  try { return JSON.parse(String(arg)); } catch (e) { return null; }
}

function findCred(data, url) {
  var out = { phone: "", token: "" };
  if (!data) return out;
  // 1) 直接字段
  try {
    if (data.phone) out.phone = String(data.phone);
    if (data.token) out.token = String(data.token);
  } catch (e) {}
  // 2) 嵌套对象扫描（登录响应常见 data.data.token 结构）
  if (!out.token || !out.phone) {
    var seen = [];
    function walk(o, depth) {
      if (!o || depth > 4) return;
      if (seen.indexOf(o) !== -1) return;
      seen.push(o);
      for (var k in o) {
        var v = o[k];
        if (v && typeof v === "object") { walk(v, depth + 1); continue; }
        if (typeof v !== "string") continue;
        var lk = String(k).toLowerCase();
        if (!out.token && lk === "token" && v.length > 40) out.token = v;
        if (!out.phone && lk === "phone" && /^\d{11}$/.test(v)) out.phone = v;
      }
    }
    try { walk(data, 0); } catch (e) {}
  }
  // 3) URL 兜底
  if (!out.token && url) {
    var m = String(url).match(/[?&]token=([^&#]+)/);
    if (m) out.token = decodeURIComponent(m[1]);
  }
  if (!out.phone && url) {
    var m2 = String(url).match(/[?&]phone=(\d{5,15})/);
    if (m2) out.phone = m2[1];
  }
  return out;
}

function validToken(t) {
  if (!t || String(t).length < 40) return false;
  var parts = String(t).split(".");
  return parts.length === 3;
}

function main() {
  var url = ($request && $request.url) || "";
  if (url.indexOf("rcopy.nikola-lab.cn") === -1 && url.indexOf("nikola-lab.cn") === -1) {
    $done({});
    return;
  }
  log("捕获请求: " + url.split("?")[0]);

  // 1) 请求体
  var bodyStr = normalizeBody(($request && $request.body) || "");
  var cred = { phone: "", token: "" };
  if (bodyStr) {
    var bj = readArgJson(bodyStr);
    if (bj) cred = findCred(bj, "");
  }
  // 2) 请求头（部分接口把 token 放 header / URL）
  if (!validToken(cred.token)) {
    var h = ($request && $request.headers) || {};
    for (var k in h) {
      var lk = String(k).toLowerCase();
      if (lk === "authorization" || lk === "token" || lk === "x-token") {
        var raw = String(h[k]).replace(/^Bearer\s+/i, "").trim();
        if (validToken(raw)) { cred.token = raw; break; }
      }
    }
  }
  if (!validToken(cred.token)) {
    var c2 = findCred(null, url);
    if (c2.token) cred.token = c2.token;
    if (c2.phone && !cred.phone) cred.phone = c2.phone;
  }

  if (!validToken(cred.token)) {
    $done({});
    return;
  }
  if (!cred.phone || !/^\d{5,15}$/.test(cred.phone)) {
    // 部分接口请求体不带 phone，交给 cron 脚本的默认手机号兜底
    var defPhone = getEnv("phone") || readStore(KEY_PHONE);
    cred.phone = defPhone || "";
  }
  if (!cred.phone) {
    log("捕获到 token 但缺少手机号，跳过保存（请在插件里填写手机号）");
    $done({});
    return;
  }

  var oldToken = readStore(KEY_TOKEN);
  if (oldToken === cred.token && readStore(KEY_PHONE) === cred.phone) {
    $done({});
    return;
  }
  writeStore(KEY_PHONE, cred.phone);
  writeStore(KEY_TOKEN, cred.token);
  writeStore(KEY_TIME, String(Date.now()));
  log("✅ 凭证已更新: phone=" + cred.phone + " token=" + cred.token.substring(0, 20) + "...");

  var notice = getEnv("notice");
  var noticeOn = notice === "" ? true : !(notice === "false" || notice === "0");
  if (noticeOn) {
    $notification.post("Rcopy 签到", "凭证已自动更新 ✓", "手机号 " + cred.phone + "\n打开小程序即可随时刷新");
  }
  $done({});
}

try { main(); } catch (e) {
  console.log(TAG + " 异常: " + e);
  console.log(TAG + " 堆栈: " + (e.stack || "无"));
  $done({});
}
