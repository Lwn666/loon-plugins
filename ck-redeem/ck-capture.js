// ============================================================
// ck-capture.js — 自动捕获 B 站 Cookie 与公益站 token
// 触发：http-request (api.bilibili.com / api.910501.xyz)
//        http-response (api.910501.xyz 登录/刷新响应)
// 存储：$persistentStore 手机端本地
// ============================================================
var KEY_BILI = "ck_bili_cookie";
var KEY_AUTH_ACCESS = "ck_gy_access";
var KEY_AUTH_REFRESH = "ck_gy_refresh";
var KEY_AUTH_EXPIRES = "ck_gy_expires";

function getCookieItem(cookie, name) {
  if (!cookie) return "";
  var m = String(cookie).match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : "";
}

function bodyToString(body) {
  if (typeof body === "string") return body;
  if (body && typeof body.length === "number") {
    var s = "";
    for (var i = 0; i < body.length; i++) s += String.fromCharCode(body[i]);
    return s;
  }
  return String(body || "");
}

function readStore(key) {
  try { return $persistentStore.read(key) || ""; } catch (e) { return ""; }
}
function writeStore(key, val) {
  try { $persistentStore.write(val, key); return true; } catch (e) { return false; }
}

// ---------- 捕获 B 站 Cookie ----------
function captureBili() {
  var headers = $request.headers || {};
  var cookie = headers["Cookie"] || headers["cookie"] || "";
  if (!cookie) return;

  var wanted = ["SESSDATA", "bili_jct", "buvid3", "buvid4", "b_nut", "DedeUserID"];
  var parts = [];
  for (var i = 0; i < wanted.length; i++) {
    var v = getCookieItem(cookie, wanted[i]);
    if (v) parts.push(wanted[i] + "=" + v);
  }
  if (!parts.length) return;

  // 核心登录态 SESSDATA 存在才算有效捕获
  var hasSession = getCookieItem(cookie, "SESSDATA") !== "";
  var newCk = parts.join("; ");
  var saved = readStore(KEY_BILI);
  if (newCk !== saved && (hasSession || saved === "")) {
    writeStore(KEY_BILI, newCk);
    $notification.post("CK 捕获", hasSession ? "B站 Cookie 已更新 ✓" : "B站 访客 Cookie 已更新",
      "SESSDATA=" + (hasSession ? "已捕获" : "无(未登录)") + " | buvid3=" + (getCookieItem(cookie, "buvid3") ? "✓" : "✗"));
  }
}

// ---------- 捕获公益站 token ----------
function captureAuth() {
  var headers = $request.headers || {};
  var auth = headers["Authorization"] || headers["authorization"] || "";
  var m = auth.match(/Bearer\s+(\S+)/);
  var url = $request.url || "";

  // 请求头里的 access_token
  if (m && m[1]) {
    var saved = readStore(KEY_AUTH_ACCESS);
    if (m[1] !== saved) {
      writeStore(KEY_AUTH_ACCESS, m[1]);
      // 估算过期：JWT exp 字段
      try {
        var payload = m[1].split(".")[1] || "";
        var pad = payload.length % 4 === 0 ? "" : "====".slice(0, 4 - payload.length % 4);
        var json = JSON.parse(base64Decode(payload + pad));
        if (json.exp) writeStore(KEY_AUTH_EXPIRES, String(json.exp * 1000));
      } catch (e) {}
      $notification.post("CK 捕获", "公益站 access_token 已更新 ✓", "来源: " + (url.indexOf("/auth/") !== -1 ? "认证接口" : "API 请求"));
    }
  }

  // /auth/refresh 请求体里的 refresh_token
  if (url.indexOf("/auth/refresh") !== -1 && $request.method === "POST") {
    var body = bodyToString($request.body);
    try {
      var obj = JSON.parse(body);
      if (obj.refresh_token) {
        var savedRt = readStore(KEY_AUTH_REFRESH);
        if (obj.refresh_token !== savedRt) {
          writeStore(KEY_AUTH_REFRESH, obj.refresh_token);
          $notification.post("CK 捕获", "公益站 refresh_token 已更新 ✓", "来源: /auth/refresh 请求");
        }
      }
    } catch (e) {}
  }
}

// ---------- 捕获登录/刷新响应体 ----------
function captureAuthResponse() {
  if (!$response) return;
  var body = bodyToString($response.body);
  if (!body) return;
  try {
    var obj = JSON.parse(body);
    var data = obj.data || obj;
    var changed = false;
    if (data.access_token && data.access_token !== readStore(KEY_AUTH_ACCESS)) {
      writeStore(KEY_AUTH_ACCESS, data.access_token);
      changed = true;
    }
    if (data.refresh_token && data.refresh_token !== readStore(KEY_AUTH_REFRESH)) {
      writeStore(KEY_AUTH_REFRESH, data.refresh_token);
      changed = true;
    }
    if (data.expires_in) {
      writeStore(KEY_AUTH_EXPIRES, String(Date.now() + data.expires_in * 1000));
      changed = true;
    }
    if (changed) {
      $notification.post("CK 捕获", "公益站登录态已刷新 ✓",
        "access=" + (readStore(KEY_AUTH_ACCESS) ? "✓" : "✗") + " refresh=" + (readStore(KEY_AUTH_REFRESH) ? "✓" : "✗"));
    }
  } catch (e) {}
}

// ---------- 纯 JS base64 解码（JWT payload） ----------
function base64Decode(str) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = new Array(256);
  for (var i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  str = String(str).replace(/[\r\n\s]+/g, "").replace(/=+$/, "");
  var out = "", buffer = 0, bits = 0;
  for (var j = 0; j < str.length; j++) {
    var val = lookup[str.charCodeAt(j)];
    if (val === undefined) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

// ---------- 入口 ----------
function main() {
  var url = $request.url || "";
  if (url.indexOf("api.bilibili.com") !== -1) {
    captureBili();
  } else if (url.indexOf("api.910501.xyz") !== -1) {
    if ($response) {
      captureAuthResponse();
    } else {
      captureAuth();
    }
  }
}

try { main(); } catch (e) {
  console.log("[CK捕获] 异常: " + e + " | " + (e.stack || ""));
}
$done({});
