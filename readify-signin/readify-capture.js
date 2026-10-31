/**
 * Readify 阅读签到 — 凭证自动捕获（http-request）
 *
 * Readify App（readifyapp.voiceclub.cn）的接口认证不是 Cookie，
 * 而是请求头里的 x-token（JWT，约 73 小时过期）+ x-user-id + x-device-id。
 * 打开 App 任意页面（书架/首页/签到页）都会带这些头，自动抓取并存本机。
 *
 * 关键头（来自抓包）：
 *   x-token          JWT（type=LOGIN，exp 约 73h）
 *   x-user-id        bac66627-...（用户 UUID）
 *   x-device-id      590E17D7-...（设备 UUID）
 *   其余（x-lang/x-os/x-time-zone/x-client-region/...）一并抓取做兜底。
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

var TAG = "[Readify捕获]";

function log(m) { console.log(TAG + " " + m); }

function readStore(k) {
  try { var v = $persistentStore.read(k); return v ? String(v) : ""; } catch (e) { return ""; }
}
function writeStore(k, v) {
  try { $persistentStore.write(String(v), k); return true; } catch (e) { return false; }
}
function getEnv(name) {
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
          for (var k in arg) if (String(k).toLowerCase() === String(name).toLowerCase()) return String(arg[k]);
        }
      }
    }
  } catch (e) {}
  return "";
}

/* JWT 校验：3 段、payload 能解出 exp */
function validToken(t) {
  if (!t || String(t).length < 40) return false;
  var parts = String(t).split(".");
  if (parts.length !== 3) return false;
  try {
    var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return typeof payload.exp === "number" || typeof payload.uid === "string" || typeof payload.id === "string";
  } catch (e) { return false; }
}

/* 从 header 里大小写不敏感取值 */
function hget(headers, name) {
  if (!headers) return "";
  var want = String(name).toLowerCase();
  for (var k in headers) {
    if (String(k).toLowerCase() === want) {
      var v = headers[k];
      if (Array.isArray(v)) v = v[0];
      return v == null ? "" : String(v);
    }
  }
  return "";
}

function main() {
  var url = ($request && $request.url) || "";
  // 只拦 Readify 主域名（含备用域名 app.readifyai.com）
  if (url.indexOf("readifyapp.voiceclub.cn") === -1 && url.indexOf("app.readifyai.com") === -1) {
    $done({});
    return;
  }
  // 签到相关接口才需要 token；其它静态资源（图片/js）不带 token，直接放行
  var h = ($request && $request.headers) || {};
  var token = hget(h, "x-token");
  if (!validToken(token)) {
    $done({});
    return;
  }
  log("捕获请求: " + url.split("?")[0]);

  var userId = hget(h, "x-user-id");
  var deviceId = hget(h, "x-device-id");
  var lang = hget(h, "x-lang");
  var os = hget(h, "x-os");
  var tz = hget(h, "x-time-zone");
  var clientRegion = hget(h, "x-client-region");
  var sysRegion = hget(h, "x-client-sys-region");
  var userAgent = hget(h, "user-agent") || hget(h, "x-user-agent");
  var appName = hget(h, "x-app-name");

  var oldToken = readStore(STORE.token);
  var changed = oldToken !== token || readStore(STORE.userId) !== userId || readStore(STORE.deviceId) !== deviceId;

  if (userId) writeStore(STORE.userId, userId);
  if (deviceId) writeStore(STORE.deviceId, deviceId);
  if (lang) writeStore(STORE.lang, lang);
  if (os) writeStore(STORE.os, os);
  if (tz) writeStore(STORE.tz, tz);
  if (clientRegion) writeStore(STORE.clientRegion, clientRegion);
  if (sysRegion) writeStore(STORE.sysRegion, sysRegion);
  if (userAgent) writeStore(STORE.userAgent, userAgent);
  if (appName) writeStore(STORE.appName, appName);

  if (changed) {
    writeStore(STORE.token, token);
    writeStore(STORE.time, String(Date.now()));
    log("✅ 凭证已更新: uid=" + (userId || "-").slice(0, 8) + "… token=" + token.slice(0, 20) + "…");

    var notice = getEnv("notice");
    var noticeOn = notice === "" ? true : !(notice === "false" || notice === "0");
    if (noticeOn) {
      $notification.post("Readify 签到", "凭证已自动更新 ✓", "打开 App 已刷新 token\n有效期约 3 天，到期前记得再打开一次");
    }
  }
  $done({});
}

try { main(); } catch (e) {
  console.log(TAG + " 异常: " + e);
  console.log(TAG + " 堆栈: " + (e.stack || "无"));
  $done({});
}
