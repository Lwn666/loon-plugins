/**
 * 1A2X 社区签到 — 登录态自动捕获（http-request）
 *
 * 站点的登录态是 Cookie：__Host-nc.sid（express-session，HttpOnly）+ __Host-nc.csrf + nc.bid。
 * HttpOnly 意味着页面 JS 读不到，只能从请求头里截。Loon 的 $request.headers 能看到完整
 * Cookie 头，因此只要用户以已登录状态访问一次 1a2x.com，就能拿到。
 *
 * 策略：
 *   1. 只处理 1a2x.com 的请求
 *   2. Cookie 里必须含 __Host-nc.sid 才算有效登录态（游客没有这个键）
 *   3. 内容变化才写 $persistentStore + 弹通知（避免每次刷新都响）
 *   4. 日志只打印 sid 前 8 位，不落完整凭证
 */
var STORE = {
  cookie: "a2x_cookie",
  ua: "a2x_user_agent",
  time: "a2x_capture_time"
};

var TAG = "[1A2X捕获]";

function log(m) { console.log(TAG + " " + m); }

function readStore(k) {
  try { var v = $persistentStore.read(k); return v ? String(v) : ""; } catch (e) { return ""; }
}
function writeStore(k, v) {
  try { $persistentStore.write(String(v), k); return true; } catch (e) { return false; }
}

/* $argument 兼容：已解析对象 / JSON 字符串 / 旧版数组 */
function getEnv(name) {
  try {
    if (typeof $argument !== "undefined" && $argument !== null && $argument !== "") {
      var arg = $argument;
      if (typeof arg === "string") { try { arg = JSON.parse(arg); } catch (e) {} }
      if (arg && typeof arg === "object") {
        if (Array.isArray(arg)) {
          var idxMap = { notice: 0, debug: 1 };
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
function flagOn(name, dflt) {
  var v = getEnv(name);
  if (v === "") return dflt;
  return !(v === "false" || v === "0");
}

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

/* 从 Cookie 串里取某个键值 */
function cookieVal(cookie, key) {
  var m = new RegExp("(?:^|;[\\s]*)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)").exec(cookie || "");
  return m ? m[1] : "";
}

function main() {
  var url = ($request && $request.url) || "";
  if (url.indexOf("1a2x.com") === -1) { $done({}); return; }

  var h = ($request && $request.headers) || {};
  var cookie = hget(h, "cookie");
  if (!cookie) { $done({}); return; }

  var sid = cookieVal(cookie, "__Host-nc.sid");
  if (!sid || sid.length < 20) { $done({}); return; }   // 游客/未登录，放行

  var ua = hget(h, "user-agent");
  var oldCookie = readStore(STORE.cookie);
  var changed = oldCookie !== cookie;

  if (changed) {
    writeStore(STORE.cookie, cookie);
    if (ua) writeStore(STORE.ua, ua);
    writeStore(STORE.time, String(Date.now()));
    log("✅ 登录态已更新: sid=" + sid.slice(0, 8) + "… cookie " + cookie.length + " 字符");

    if (flagOn("notice", true)) {
      $notification.post("1A2X 签到", "登录态已自动更新 ✓", "之后每天自动签到\n凭证失效时重新浏览一次 1a2x.com 即可");
    }
  } else {
    log("登录态无变化（sid=" + sid.slice(0, 8) + "…）");
  }
  $done({});
}

try { main(); } catch (e) {
  console.log(TAG + " 异常: " + e);
  console.log(TAG + " 堆栈: " + (e.stack || "无"));
  $done({});
}
