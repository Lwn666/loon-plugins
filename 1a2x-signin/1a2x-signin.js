/*
 * 1A2X 社区（https://1a2x.com）每日签到
 * ------------------------------------------------------------------
 * 站点是服务端渲染表单，没有 JSON API：
 *   1) GET  /growth          → 页面内含 <form class="daily-checkin" action="/growth/checkin">
 *                              以及 <input type="hidden" name="_csrf" value="...">
 *   2) POST /growth/checkin  → _csrf=<token>&return_to=/growth   （302 回 /growth）
 *   3) 已签特征：「今日已签到」文案 / 签到按钮带 disabled
 * 认证：Cookie（__Host-nc.sid 等），由 1a2x-capture.js 截获请求头得到。
 * ------------------------------------------------------------------
 */

var STORE = {
  cookie: "a2x_cookie",
  ua: "a2x_user_agent",
  time: "a2x_capture_time"
};

var BASE = "https://1a2x.com";
var TITLE = "1A2X 签到";
var TIMEOUT = 25000;   // $httpClient 的 timeout 单位是毫秒

/* ---------- 参数 / 存储 ---------- */
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
function log(s) { console.log("[1A2X] " + s); }

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
  var out = "";
  var i, n;
  for (i = 0; i < arr.length; i++) {
    n = arr[i] & 0xff;
    if (n < 0x80) out += String.fromCharCode(n);
    else if (n >= 0xc0) {
      // 交给 decodeURIComponent 处理多字节
      out += "%" + ("0" + n.toString(16)).slice(-2);
    } else out += "%" + ("0" + n.toString(16)).slice(-2);
  }
  try { return decodeURIComponent(out); } catch (e) { return out; }
}

function notify(sub, msg) {
  $notification.post(TITLE, sub, msg);
  console.log(TITLE + " - " + sub + ": " + msg.replace(/\n/g, " / "));
  try { $done(); } catch (e) {}
}

/* ---------- 请求 ---------- */
function headers(extra) {
  var h = {
    "Cookie": readStore(STORE.cookie),
    "User-Agent": readStore(STORE.ua) || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": BASE + "/growth",
    "Origin": BASE
  };
  for (var k in extra) h[k] = extra[k];
  return h;
}

function req(method, path, body, cb, left) {
  var tries = left === undefined ? 2 : left;
  var opts = {
    url: BASE + path,
    timeout: TIMEOUT,
    headers: headers(body ? { "Content-Type": "application/x-www-form-urlencoded" } : null),
    body: body || undefined
  };
  var back = function (err, resp, raw) {
    if (err && tries > 0) {
      log("请求失败（" + (err.message || err) + "），2 秒后重试");
      return setTimeout(function () { req(method, path, body, cb, tries - 1); }, 2000);
    }
    cb(err, resp, raw);
  };
  if (method === "POST") $httpClient.post(opts, back); else $httpClient.get(opts, back);
}

/* ---------- 页面解析 ---------- */
function loggedIn(html) {
  if (!html) return false;
  if (/name="password"/i.test(html) && html.indexOf("/logout") === -1) return false;
  return html.indexOf("/logout") !== -1 || html.indexOf("header-user") !== -1 || html.indexOf("退出登录") !== -1;
}

function alreadyDone(html) {
  if (!html) return false;
  if (html.indexOf("今日已签到") !== -1) return true;
  var m = /<form[^>]*class="[^"]*daily-checkin[^"]*"[\s\S]*?<\/form>/i.exec(html);
  if (m) {
    var btn = /<button[^>]*>/i.exec(m[0]);
    if (btn && /disabled/i.test(btn[0])) return true;
  }
  return false;
}

function extractCsrf(html) {
  if (!html) return "";
  var pats = [
    /<input[^>]*name="_csrf"[^>]*value="([^"]+)"/i,
    /<input[^>]*value="([^"]+)"[^>]*name="_csrf"/i,
    /<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/i,
    /<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/i,
    /"csrfToken"\s*:\s*"([^"]+)"/
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = pats[i].exec(html);
    if (m) return m[1];
  }
  return "";
}

function metric(html, name) {
  if (!html) return null;
  var m = new RegExp('data-member-metric="' + name + '"[\\s\\S]{0,400}?<dd[^>]*>\\s*([\\d,]+)', "i").exec(html);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

function streaks(html) {
  if (!html) return null;
  var m = /连续签到[^\d]{0,20}(\d+)\s*天/.exec(html);
  return m ? parseInt(m[1], 10) : null;
}

function snippet(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/* ---------- 主流程 ---------- */
(function main() {
  var cookie = readStore(STORE.cookie);

  if (!cookie) {
    return notify("⚠️ 缺少登录凭证", "还没捕获到 1a2x.com 的 Cookie\n请用 Safari 打开一次已登录的 1a2x.com 页面");
  }
  if (cookie.indexOf("__Host-nc.sid") === -1) {
    return notify("⚠️ 凭证不完整", "Cookie 里没有 __Host-nc.sid\n请重新登录并浏览一次 1a2x.com");
  }

  if (DEBUG) log("cookie 长度 " + cookie.length + "，捕获时间 " + (readStore(STORE.time) || "-"));

  log("#### 打开成长页");
  req("GET", "/growth", null, function (err, resp, raw) {
    if (err || !resp) return notify("❌ 网络错误", "打开成长页失败：" + (err && err.message ? err.message : String(err)));

    var html = toStr(raw);
    var status = resp.status || 0;
    if (DEBUG) log("HTTP " + status + " 长度 " + html.length + " 片段：" + snippet(html));

    if (status === 403 || status === 429) {
      return notify("⚠️ 被风控拦截", "HTTP " + status + "，稍后再试\n（可能触发 Cloudflare 限流）");
    }
    if (status >= 500) {
      return notify("❌ 站点异常", "HTTP " + status + "，稍后重试");
    }
    if (!loggedIn(html)) {
      return notify("🔑 凭证已失效", "站点要求重新登录\n用 Safari 登录 1a2x.com 并浏览一次即可刷新");
    }

    var before = metric(html, "bananas");
    var st = streaks(html);
    log("- 香蕉: " + (before === null ? "-" : before) + " / 连续签到: " + (st === null ? "-" : st + " 天"));

    if (alreadyDone(html)) {
      return notify("✅ 今日已签到", "香蕉 " + (before === null ? "-" : before) + (st !== null ? " · 连续 " + st + " 天" : "") + "\n无需重复操作");
    }

    var csrf = extractCsrf(html);
    if (!csrf) {
      return notify("❌ 未找到 CSRF", "页面结构可能已变更（daily-checkin 表单里没有 _csrf）\n请反馈");
    }
    log("---- 提交签到（csrf " + csrf.slice(0, 8) + "…）");

    var body = "_csrf=" + encodeURIComponent(csrf) + "&return_to=" + encodeURIComponent("/growth");
    req("POST", "/growth/checkin", body, function (err2, resp2, raw2) {
      if (err2 || !resp2) return notify("❌ 网络错误", "签到请求失败：" + (err2 && err2.message ? err2.message : String(err2)));

      var st2 = resp2.status || 0;
      var body2 = toStr(raw2);
      if (DEBUG) log("签到响应 HTTP " + st2 + " / 长度 " + body2.length + " / " + snippet(body2));

      if (body2.indexOf("Invalid form token") !== -1 || body2.indexOf("表单已过期") !== -1) {
        return notify("🔑 表单令牌失效", "CSRF 校验失败，Cookie 可能已过期\n用 Safari 重新登录并浏览一次 1a2x.com");
      }
      if (st2 === 403 || st2 === 429) {
        return notify("⚠️ 被风控拦截", "签到返回 HTTP " + st2 + "，稍后再试");
      }

      log("---- 回读成长页确认");
      req("GET", "/growth", null, function (err3, resp3, raw3) {
        if (err3 || !resp3) return notify("⚠️ 结果未知", "签到请求已发出，但回读失败：" + (err3 && err3.message ? err3.message : String(err3)) + "\n请手动确认");

        var after = toStr(raw3);
        var doneOk = alreadyDone(after);
        var banana2 = metric(after, "bananas");
        var st3 = streaks(after);

        if (!doneOk) {
          if (body2.indexOf("今日已签到") !== -1) doneOk = true;
          else return notify("⚠️ 签到结果未知", "HTTP " + st2 + " / 页面仍显示未签到\n" + snippet(body2));
        }

        var gain = (before !== null && banana2 !== null) ? (banana2 - before) : null;
        var line = "香蕉 " + (banana2 === null ? "-" : banana2) + (gain !== null && gain > 0 ? "（+" + gain + "）" : "");
        if (st3 !== null) line += " · 连续 " + st3 + " 天";
        return notify("✅ 签到成功", line);
      });
    });
  });
})();
