/*
 * THTV / 探花社区 (satomi.cc) 每日签到
 * ------------------------------------------------------------------
 * 登录接口（前端 /static/js/login.js 实测）：
 *   POST https://satomi.cc/login
 *   {"email":"...","password":"...","rememberMe":true}
 *   → Set-Cookie: loginToken=UIDxxx_<32hex>  +  SESSION=<base64>
 * 签到接口：POST https://satomi.cc/api/sign-in   （只认 cookie）
 *
 * 逻辑：cookie 有效 → 直接签到
 *      cookie 失效 → 用账号密码自动重新登录换票 → 重试一次
 *      首次运行无 cookie → 先登录再签到
 * 凭证只存本机 $persistentStore，不上传。
 * ------------------------------------------------------------------
 */

const STORE = {
  token: "thtv_login_token",
  session: "thtv_session",
  account: "thtv_account",
  password: "thtv_password"
};

const P = (function () {                       // 插件参数 / 手写变量
  let a = null;
  try { if (typeof $argument === "object" && $argument) a = $argument; } catch (e) {}
  try { if (!a && typeof $argument === "string" && $argument) a = JSON.parse($argument); } catch (e) {}
  return a || {};
})();
function arg(k) {
  if (P[k] !== undefined && P[k] !== null && String(P[k]) !== "") return String(P[k]).trim();
  try { return String($persistentStore.read(k) || "").trim(); } catch (e) { return ""; }
}
function flag(k) { return /^(true|1|on|yes)$/i.test(arg(k)); }

const ORIGIN = "https://satomi.cc";
const SIGN_IN = ORIGIN + "/api/sign-in";
const LOGIN = (arg("LOGIN_API") || ORIGIN + "/login").split(/[,\s]+/)[0];
const DEBUG = flag("DEBUG");
const TIMEOUT = 20;                             // 单位：秒
const TITLE = "THTV 签到";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/* ---------- 账号解析：每行/分号一个，邮箱#密码（也兼容 : 和 空格） ---------- */
function accounts() {
  const raw = arg("ACCOUNTS");
  if (!raw) {
    const a = arg("thtv_account"), p = arg("thtv_password");
    return a ? [{ user: a, pass: p }] : [];
  }
  const out = [];
  raw.split(/[\n;]+/).forEach(function (line) {
    line = line.trim();
    if (!line) return;
    const m = line.match(/^(.+?)\s*[#|]\s*(.+)$/) || line.match(/^(\S+@\S+?)\s*[:：]\s*(\S.*)$/) || line.match(/^(\S+@\S+)\s+(\S+)$/);
    if (m) out.push({ user: m[1].trim(), pass: m[2].trim() });
    else if (/@/.test(line)) out.push({ user: line, pass: "" });   // 只填邮箱 → 用缓存 cookie，不自动换票
  });
  return out;
}
function ckKey(kind, user) { return "thtv_" + kind + "_" + (user || "default").replace(/[^\w@.-]/g, "_"); }

/* ---------- 响应解码：Loon 有时把 body 当字节数组返回 ---------- */
function toStr(b) {
  if (b == null) return "";
  if (typeof b === "string") return b;
  let arr = null;
  if (b instanceof ArrayBuffer) arr = Array.prototype.slice.call(new Uint8Array(b));
  else if (typeof b === "object" && typeof b.length === "number") arr = Array.prototype.slice.call(b);
  else if (typeof b === "object") {
    const ks = Object.keys(b).filter(function (x) { return /^\d+$/.test(x); }).map(Number).sort(function (a, c) { return a - c; });
    if (ks.length) arr = ks.map(function (i) { return b[i]; });
  }
  if (!arr) return String(b);
  let s = "";
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i] & 0xff;
    if (n < 32 && n !== 9 && n !== 10 && n !== 13) continue;   // 丢掉二进制噪声
    s += String.fromCharCode(n);
  }
  return s;
}
function cut(s) { const a = s.indexOf("{"), z = s.lastIndexOf("}"); return a >= 0 && z > a ? s.slice(a, z + 1) : s; }
function fixUtf8(s) {                                          // latin1 乱码 → 中文
  if (!/[\u0080-\u00ff]/.test(s) || /[\u0100-\uffff]/.test(s)) return s;
  try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
}
function text(b) { return fixUtf8(cut(toStr(b))); }
function json(b) { try { return JSON.parse(text(b)); } catch (e) { return null; } }

function cookieStr(resp) {
  const h = (resp && resp.headers) || {};
  let raw = h["Set-Cookie"] || h["set-cookie"] || h["setCookie"] || "";
  if (Array.isArray(raw)) raw = raw.join("\n");
  return String(raw);
}
function pick(str, name) {
  const m = String(str).match(new RegExp("\\b" + name + "=([^;,\\s]+)"));
  return m ? m[1] : "";
}

function req(opts, cb) {
  const o = {
    url: opts.url, timeout: TIMEOUT,
    header: opts.header || {}, headers: opts.header || {},
    body: opts.body
  };
  (opts.method === "POST" ? $httpClient.post(o, cb) : $httpClient.get(o, cb));
}
function log(s) { console.log("[THTV] " + s); }
function notify(sub, msg) {
  $notification.post(TITLE, sub, msg);
  console.log(TITLE + " - " + sub + ": " + msg);
  try { $done(); } catch (e) {}          // 收尾，让 Loon 释放脚本
}

/* ---------- 登录换票 ---------- */
function doLogin(acct, cb) {
  const body = JSON.stringify({ email: acct.user, password: acct.pass, rememberMe: true });
  if (DEBUG) log("登录 " + acct.user + " → " + LOGIN);
  req({
    url: LOGIN, method: "POST",
    header: {
      "Origin": ORIGIN, "Referer": ORIGIN + "/login",
      "Content-Type": "application/json", "Accept": "application/json, text/plain, */*",
      "User-Agent": UA
    },
    body: body
  }, function (err, resp, raw) {
    if (err || !resp) return cb("网络错误：" + (err && err.message ? err.message : String(err)));
    const sc = cookieStr(resp);
    const d = json(raw);
    const blob = String(raw || "") + "\n" + sc;
    let tok = pick(sc, "loginToken"), ses = pick(sc, "SESSION");
    if (!tok) { const m = blob.match(/loginToken=(UID\w+_[0-9a-f]{32})/i); if (m) tok = m[1]; }
    if (!ses) { const m = blob.match(/SESSION=([A-Za-z0-9_\-=]{16,})/); if (m) ses = m[1]; }

    // 关键：登录失败时服务端照样下发匿名 SESSION → 必须以 success===true 为准
    const okFlag = d ? d.success === true : (!!tok && (resp.status || 0) === 200);
    if (!okFlag) {
      if (DEBUG) log("登录被拒：" + ((d && d.message) || "HTTP " + (resp.status || "?")));
      return cb((d && d.message) || ("登录失败 HTTP " + (resp.status || "?") + " " + text(raw).slice(0, 80)));
    }
    if (!tok && !ses) return cb("登录成功但响应里没有 cookie");

    try {
      if (tok) $persistentStore.write(tok, ckKey("login_token", acct.user));
      if (ses) $persistentStore.write(ses, ckKey("session", acct.user));
      $persistentStore.write(acct.user, "thtv_last_account");
    } catch (e) {}
    log("换票成功 " + acct.user + " loginToken=" + String(tok || "-").slice(0, 22) + "… SESSION=" + String(ses || "-").slice(0, 12) + "…");
    cb(null, { token: tok, session: ses });
  });
}

/* ---------- 签到 ---------- */
function doSignIn(acct, ticket, retried, cb) {
  const ck = [];
  if (ticket.token) ck.push("loginToken=" + ticket.token);
  if (ticket.session) ck.push("SESSION=" + ticket.session);

  req({
    url: SIGN_IN, method: "POST",
    header: {
      "Origin": ORIGIN, "Referer": ORIGIN + "/",
      "Content-Type": "application/json", "Accept": "application/json, text/plain, */*",
      "User-Agent": UA, "Cookie": ck.join("; ")
    },
    body: "{}"
  }, function (err, resp, raw) {
    if (err || !resp) return cb("网络错误：" + (err && err.message ? err.message : String(err)));

    const sc = cookieStr(resp);                       // 服务端续发的 cookie 一律跟随
    const nt = pick(sc, "loginToken"), ns = pick(sc, "SESSION");
    try {
      if (nt && nt !== ticket.token) { ticket.token = nt; $persistentStore.write(nt, ckKey("login_token", acct.user)); }
      if (ns && ns !== ticket.session) { ticket.session = ns; $persistentStore.write(ns, ckKey("session", acct.user)); }
    } catch (e) {}

    const d = json(raw);
    const st = resp.status || 0;
    const msg = (d && d.message) || text(raw) || "";

    if (d && d.success === true) return cb(null, "成功", msg || "签到成功");
    if (/已到过|已签到|已经签到|重复签到/.test(msg)) return cb(null, "已签", msg);

    const needLogin = /请先登录|未登录|登录已?过期|重新登录|失效/.test(msg) || st === 401 || st === 403;
    if (needLogin && !retried && acct.pass) {
      log("cookie 失效，自动换票重试");
      return doLogin(acct, function (e, t2) {
        if (e) return cb("换票失败：" + e);
        doSignIn(acct, t2, true, cb);
      });
    }
    if (needLogin) return cb(null, "失效", msg || "请先登录（未配置密码，无法自动换票）");
    if (st !== 200) return cb(null, "HTTP " + st, msg.slice(0, 150) || "无内容");
    cb(null, "提示", msg.slice(0, 150) || JSON.stringify(d || {}).slice(0, 150));
  });
}

/* ---------- 主流程 ---------- */
(function main() {
  const list = accounts();
  if (!list.length) {
    return notify("⚠️ 未配置账号", "请在插件参数 ACCOUNTS 里填写，格式：\n邮箱#密码\n多账号每行一个");
  }
  const results = [];
  let i = 0;
  (function next() {
    if (i >= list.length) {
      const ok = results.filter(function (r) { return r.ok; }).length;
      const sub = results.length > 1 ? ("完成 " + ok + "/" + results.length) : results[0].sub;
      return notify(sub, results.map(function (r) {
        return (results.length > 1 ? r.user + "：" : "") + r.msg;
      }).join("\n"));
    }
    const acct = list[i++];
    let ticket = { token: "", session: "" };
    try {
      ticket.token = $persistentStore.read(ckKey("login_token", acct.user)) || "";
      ticket.session = $persistentStore.read(ckKey("session", acct.user)) || "";
    } catch (e) {}
    if (DEBUG) log(acct.user + " 已有 cookie: token=" + !!ticket.token + " session=" + !!ticket.session);

    const go = function (t) {
      doSignIn(acct, t, false, function (err, sub, msg) {
        const ok = !err && (sub === "成功" || sub === "已签");
        results.push({ user: acct.user, ok: ok, sub: err ? "❌ 失败" : ({ "成功": "✅ 成功", "已签": "ℹ️ 今日已签", "失效": "🔑 需要登录", "提示": "⚠️ 提示" }[sub] || sub), msg: err || msg });
        next();
      });
    };
    if (ticket.token || ticket.session) go(ticket);
    else if (acct.pass) doLogin(acct, function (e, t2) { if (e) { results.push({ user: acct.user, ok: false, sub: "❌ 失败", msg: e }); return next(); } go(t2); });
    else { results.push({ user: acct.user, ok: false, sub: "❌ 失败", msg: "无缓存 cookie 且未提供密码" }); next(); }
  })();
})();
