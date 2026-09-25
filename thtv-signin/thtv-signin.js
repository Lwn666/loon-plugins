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
 *      被 Cloudflare 挑战拦下 → 不换票，如实提示（见下）
 * 凭证只存本机 $persistentStore，不上传。
 * 网络：$httpClient 的 timeout 单位是毫秒（官方默认 5000），本脚本用 20000ms——
 *      实测设备到 satomi.cc 单次请求慢时可达 ~17s，官方默认 5000ms 会误判超时。
 *
 * 2026-09-25 修复（站点新上 Cloudflare 托管挑战后暴露的三个问题）：
 *   1. CF 挑战（403 + "Just a moment..."）被误判成「cookie 失效」→ 去自动换票 →
 *      登录接口同样被拦 → 报「换票失败：登录失败 HTTP 403 + 挑战页 HTML」，把排查带偏。
 *      现在先做挑战识别，命中则重试 1 次后如实上报「🚧 CF拦截」，绝不触发换票。
 *   2. 签到成功的真实响应【没有 success 字段】：
 *      {"currentExp":3525,"level":{"minExp":3000,"level":9,...}}
 *      旧版只认 success===true，会把成功当成「⚠️ 提示」。现按字段特征判成功并显示经验/等级。
 *   3. 已签到的文案是「今天已经签到过了」（含"已经签到"），旧正则恰好能覆盖，一并补"签到过"。
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
const TIMEOUT = 20000;                          // 毫秒！$httpClient 的 timeout 单位是 ms（官方默认 5000）
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

/* ---------- Cloudflare 托管挑战识别 ----------
 * 站点开启 CF 托管挑战后，任何非 JS 请求都会被 403 + "Just a moment..." 挑战页拦下。
 * 这与「凭证失效」是完全不同的两件事：旧版把它当成 cookie 失效 → 去自动换票 →
 * 登录接口同样被拦 → 报出「换票失败：登录失败 HTTP 403 + 挑战页 HTML」，误导排查方向。
 */
function isChallenge(resp, raw) {
  const h = (resp && resp.headers) || {};
  const mit = String(h["cf-mitigated"] || h["CF-Mitigated"] || "");
  if (/challenge/i.test(mit)) return true;
  return /Just a moment|challenges\.cloudflare\.com|__cf_chl|Enable JavaScript and cookies to continue/i.test(toStr(raw));
}

/* ---------- 签到结果解析 ----------
 * 实测两种成功形态：
 *   首次签到成功 → {"currentExp":3525,"level":{"minExp":3000,"level":9,...}}  ← 没有 success 字段！
 *   今日已签     → {"success":false,"message":"今天已经签到过了"}
 */
function parseSignResult(d, raw, st) {
  if (d && typeof d === "object") {
    if (d.success === true) return { kind: "ok", msg: String(d.message || "签到成功") };
    if (d.success === false) {
      const m = String(d.message || "");
      if (/已到过|已签到|已经签到|签到过|重复签到/.test(m)) return { kind: "signed", msg: m };
      if (/请先登录|未登录|登录已?过期|重新登录|失效/.test(m)) return { kind: "needlogin", msg: m };
      return { kind: "fail", msg: m || "服务端返回 success=false" };
    }
    const exp = d.currentExp;
    const lv = d.level && typeof d.level === "object" ? d.level.level : d.level;
    if (exp !== undefined || lv !== undefined) {
      return {
        kind: "ok",
        msg: "签到成功" + (exp !== undefined ? " · 经验 " + exp : "") + (lv !== undefined ? " · Lv" + lv : "")
      };
    }
    return { kind: "unknown", msg: JSON.stringify(d).slice(0, 150) };
  }
  const msg = text(raw) || "";
  if (/已到过|已签到|已经签到|签到过|重复签到/.test(msg)) return { kind: "signed", msg };
  if (/请先登录|未登录|登录已?过期|重新登录|失效/.test(msg)) return { kind: "needlogin", msg };
  if (st !== 200) return { kind: "fail", msg: msg.slice(0, 150) || "HTTP " + st };
  return { kind: "unknown", msg: msg.slice(0, 150) || "无内容" };
}

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

/* 发请求；网络错误（超时/断开）自动重试 1 次——设备到站点的链路抖动大，单次失败不代表没网 */
function req(opts, cb, left) {
  const o = {
    url: opts.url, timeout: TIMEOUT,
    header: opts.header || {}, headers: opts.header || {},
    body: opts.body
  };
  const tries = left === undefined ? 1 : left;
  const back = function (err, resp, raw) {
    if (err && tries > 0) {
      log("请求失败（" + err + "），1 秒后重试");
      return setTimeout(function () { req(opts, cb, tries - 1); }, 1000);
    }
    cb(err, resp, raw);
  };
  if (opts.method === "POST") $httpClient.post(o, back); else $httpClient.get(o, back);
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
      "User-Agent": arg("UA_OVERRIDE") || UA
    },
    body: body
  }, function (err, resp, raw) {
    if (err || !resp) return cb("网络错误：" + (err && err.message ? err.message : String(err)));
    // CF 挑战拦下登录接口 —— 换票这条路同样走不通，如实上报，别让它看起来像"密码错了"
    if (isChallenge(resp, raw)) return cb("被 Cloudflare 挑战拦截：登录接口返回 403 挑战页，站点当前不允许非浏览器请求登录");
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
function doSignIn(acct, ticket, retried, cb, cfLeft) {
  const ck = [];
  if (ticket.token) ck.push("loginToken=" + ticket.token);
  if (ticket.session) ck.push("SESSION=" + ticket.session);
  const cf = arg("CF_CLEARANCE") || ticket.cf || "";
  if (cf) ck.push("cf_clearance=" + cf);
  const ua = arg("UA_OVERRIDE") || ticket.ua || UA;

  req({
    url: SIGN_IN, method: "POST",
    header: {
      "Origin": ORIGIN, "Referer": ORIGIN + "/",
      "Content-Type": "application/json", "Accept": "application/json, text/plain, */*",
      "User-Agent": ua, "Cookie": ck.join("; ")
    },
    body: "{}"
  }, function (err, resp, raw) {
    if (err || !resp) return cb("网络错误：" + (err && err.message ? err.message : String(err)));

    // ① CF 托管挑战：实测同条件会概率性 200/403 → 先重试，仍被拦就如实上报，
    //    绝不当作"cookie 失效"去换票（换票接口同样被拦，只会掩盖真因）
    if (isChallenge(resp, raw)) {
      if (cfLeft > 0) {
        log("被 Cloudflare 挑战拦截，3 秒后重试（剩余 " + cfLeft + " 次）");
        return setTimeout(function () { doSignIn(acct, ticket, retried, cb, cfLeft - 1); }, 3000);
      }
      return cb(null, "拦截", "站点开启了 Cloudflare 托管挑战，脚本请求被 403 拦下（非凭证问题）。\n" +
        "处理：用浏览器打开一次 satomi.cc，等挑战自动通过（约 10-20 秒）后再试；或稍后重试。");
    }

    const sc = cookieStr(resp);                       // 服务端续发的 cookie 一律跟随
    const nt = pick(sc, "loginToken"), ns = pick(sc, "SESSION");
    try {
      if (nt && nt !== ticket.token) { ticket.token = nt; $persistentStore.write(nt, ckKey("login_token", acct.user)); }
      if (ns && ns !== ticket.session) { ticket.session = ns; $persistentStore.write(ns, ckKey("session", acct.user)); }
    } catch (e) {}

    const d = json(raw);
    const st = resp.status || 0;
    const r = parseSignResult(d, raw, st);

    if (r.kind === "ok") return cb(null, "成功", r.msg);
    if (r.kind === "signed") return cb(null, "已签", r.msg);
    if (r.kind === "unknown") return cb(null, "提示", r.msg);

    const needLogin = r.kind === "needlogin" || st === 401 || st === 403;
    if (needLogin && !retried && acct.pass) {
      log("cookie 失效，自动换票重试");
      return doLogin(acct, function (e, t2) {
        if (e) return cb("换票失败：" + e);
        ticket.token = t2.token; ticket.session = t2.session;
        doSignIn(acct, ticket, true, cb, cfLeft);
      });
    }
    if (needLogin) return cb(null, "失效", r.msg || "请先登录（未配置密码，无法自动换票）");
    cb(null, "HTTP " + st, r.msg);
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
      // 捕获脚本抓到的凭证兜底（仅单账号时可用，避免多账号串号）
      if (!ticket.token && list.length === 1) {
        ticket.token = $persistentStore.read("thtv_captured_login_token") || "";
        ticket.session = $persistentStore.read("thtv_captured_session") || ticket.session;
        if (ticket.token && DEBUG) log("使用捕获脚本抓到的凭证");
      }
    } catch (e) {}
    if (DEBUG) log(acct.user + " 已有 cookie: token=" + !!ticket.token + " session=" + !!ticket.session);

    const go = function (t) {
      doSignIn(acct, t, false, function (err, sub, msg) {
        const ok = !err && (sub === "成功" || sub === "已签");
        const label = err ? "❌ 失败"
          : ({ "成功": "✅ 成功", "已签": "ℹ️ 今日已签", "失效": "🔑 需要登录",
               "拦截": "🚧 CF拦截", "提示": "⚠️ 提示" }[sub] || sub);
        results.push({ user: acct.user, ok: ok, sub: label, msg: err || msg });
        next();
      }, 1);
    };
    if (ticket.token || ticket.session) go(ticket);
    else if (acct.pass) doLogin(acct, function (e, t2) { if (e) { results.push({ user: acct.user, ok: false, sub: "❌ 失败", msg: e }); return next(); } go(t2); });
    else { results.push({ user: acct.user, ok: false, sub: "❌ 失败", msg: "无缓存 cookie 且未提供密码" }); next(); }
  })();
})();
