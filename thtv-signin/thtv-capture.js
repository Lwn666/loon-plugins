/*
 * THTV 凭证 / CF 挑战令牌捕获（http-request）
 * 匹配: satomi.cc 任意请求
 * ------------------------------------------------------------------
 * 背景：站点开启 Cloudflare 托管挑战后，$httpClient 的请求一律被 403 挑战页拦下
 *      （挑战是交互式的，需要手动点一下才过），脚本无法自行解算。
 *      但你在浏览器里手动过完挑战后，浏览器会拿到 cf_clearance，
 *      本脚本就把它 + 配套的 User-Agent 截获存下来，供签到脚本复用。
 *
 * ⚠️ 两个关键约束：
 *   1. cf_clearance 绑定「UA + 出口 IP」→ 必须连 UA 一起存（换 UA 立刻 403）
 *   2. 服务端会给**匿名访客**也下发 SESSION → 只有当请求里带 loginToken
 *      （= 真登录态，仅 rememberMe 登录才有）时才回写 loginToken/SESSION，
 *      否则会把匿名 SESSION 写成账号凭证（09-21 踩过这个假阳性）
 * ------------------------------------------------------------------
 */

const KEY_CF = "CF_CLEARANCE";
const KEY_UA = "UA_OVERRIDE";
const KEY_TOK = "thtv_captured_login_token";
const KEY_SES = "thtv_captured_session";
const KEY_TS = "thtv_capture_time";
const TAG = "[THTV捕获]";

/* ---------- 参数/开关 ---------- */
const P = (function () {
  let a = null;
  try { if (typeof $argument === "object" && $argument) a = $argument; } catch (e) {}
  try { if (!a && typeof $argument === "string" && $argument) a = JSON.parse($argument); } catch (e) {}
  return a || {};
})();
function arg(k) {
  if (P[k] !== undefined && P[k] !== null && String(P[k]) !== "") return String(P[k]).trim();
  try { return String($persistentStore.read(k) || "").trim(); } catch (e) { return ""; }
}
function log(s) { console.log(TAG + " " + s); }

/* ---------- 账号解析（只用来判断"是否单账号"，多账号时不回写凭证） ---------- */
function accounts() {
  const raw = arg("ACCOUNTS");
  if (!raw) return [];
  return raw.split(/[\n;]+/).map(function (l) { return l.trim(); }).filter(function (l) { return l; });
}
function ckKey(kind, user) { return "thtv_" + kind + "_" + String(user).replace(/[^\w@.-]/g, "_"); }

function header(name) {
  const h = ($request && $request.headers) || {};
  const want = String(name).toLowerCase();
  for (const k in h) { if (String(k).toLowerCase() === want) return String(h[k]); }
  return "";
}
function pick(cookie, name) {
  const m = String(cookie).match(new RegExp("(?:^|;\\s*)" + name + "=([^;,\\s]+)"));
  return m ? m[1] : "";
}

function main() {
  const url = ($request && $request.url) || "";
  if (url.indexOf("satomi.cc") === -1) { $done({}); return; }

  const cookie = header("Cookie");
  const ua = header("User-Agent");
  const cf = pick(cookie, "cf_clearance");
  const tok = pick(cookie, "loginToken");
  const ses = pick(cookie, "SESSION");

  let changed = [];

  // ① cf_clearance + 配套 UA（cf_clearance 绑定 UA，必须成对保存）
  if (cf && ua) {
    const oldCf = arg(KEY_CF), oldUa = arg(KEY_UA);
    if (oldCf !== cf || oldUa !== ua) {
      try {
        $persistentStore.write(cf, KEY_CF);
        $persistentStore.write(ua, KEY_UA);
        $persistentStore.write(String(Date.now()), KEY_TS);
        changed.push("cf_clearance");
      } catch (e) { log("写入 cf_clearance 失败: " + e); }
    }
  }

  // ② 登录凭证：只有带 loginToken 才回写（匿名访客也有 SESSION，不能收）
  const list = accounts();
  if (tok && list.length === 1) {
    const user = list[0].split(/[#|]/)[0].trim();
    const oldTok = String($persistentStore.read(ckKey("login_token", user)) || "");
    if (oldTok !== tok) {
      try {
        $persistentStore.write(tok, ckKey("login_token", user));
        if (ses) $persistentStore.write(ses, ckKey("session", user));
        $persistentStore.write(tok, KEY_TOK);
        if (ses) $persistentStore.write(ses, KEY_SES);
        changed.push("loginToken");
      } catch (e) { log("写入 loginToken 失败: " + e); }
    }
  } else if (tok && list.length > 1) {
    log("检测到登录态但配置了 " + list.length + " 个账号，无法判断归属，跳过凭证回写");
  }

  if (changed.length) {
    log("已更新: " + changed.join(" + ") + (tok ? "（含登录态）" : "") );
    if (changed.indexOf("cf_clearance") >= 0) {
      $notification.post("THTV 凭证捕获", "CF 挑战令牌已更新 ✓",
        "cf_clearance + UA 已保存，签到脚本会自动复用。" +
        (!tok ? "\n（未检测到登录态：请确认已在浏览器登录 satomi.cc）" : ""));
    }
  }
  $done({});
}

try { main(); } catch (e) {
  log("异常: " + e);
  $done({});
}
