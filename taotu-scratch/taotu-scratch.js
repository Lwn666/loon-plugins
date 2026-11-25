/**
 * 乐蛙影视（FlixPilot）· 每日自动签到 + 会员到期前自动续期
 * 站点: https://ue2.taotu.ink
 *
 * 接口（2026-11-25 面板大改后的新版）:
 *   POST /api/auth/login   {username,password}   -> Set-Cookie: auth-token（HttpOnly）
 *   GET  /api/auth/me                            -> {authenticated, user:{popcorn, membershipExpiry, lastSignIn, signInStreak}}
 *   GET  /api/auth/sign-in                       -> {enabled, base:{popcorn,...}, milestones[]}
 *   POST /api/auth/sign-in                       -> {success, message, popcorn, streak}
 *   GET  /api/shop                               -> {items[], wallet:{popcorn,balance}}
 *   POST /api/shop         {itemId}              -> {items, wallet, rewardMessage}
 *
 * 流程: 登录态校验(必要时重新登录) -> 每日签到 -> 会员剩余天数不足阈值时买月卡续期 -> 汇总通知
 * 用法: Loon 插件 cron 定时跑; 也可在 Loon「脚本」里手动跑一次
 */

const BASE = "https://ue2.taotu.ink";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const TKEY = "flixpilot_auth_token";

// ---------- 参数解析（$argument 可能是对象 / JSON 字符串 / 旧数组顺序） ----------
function parseArg() {
  let a = typeof $argument !== "undefined" ? $argument : undefined;
  if (typeof a === "string") {
    try { a = JSON.parse(a); } catch (e) {
      const o = {};
      String(a).split(/[&;,]/).forEach(function (kv) {
        const i = kv.indexOf("=");
        if (i > 0) {
          let v = kv.slice(i + 1).trim();
          try { v = decodeURIComponent(v); } catch (e2) {}
          o[kv.slice(0, i).trim()] = v;
        }
      });
      a = o;
    }
  }
  if (Array.isArray(a)) {
    // 旧版数组按插件声明顺序 [USERNAME, PASSWORD, RENEW, RENEW_DAYS, NOTIFY]
    const flat = a.map(function (v) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const ks = Object.keys(v);
        return ks.length ? v[ks[0]] : undefined;
      }
      return v;
    });
    return { username: flat[0], password: flat[1], renew: flat[2], renew_days: flat[3], notify: flat[4] };
  }
  return a && typeof a === "object" ? a : {};
}
const A = parseArg();
function gv(name, def) {
  const keys = Object.keys(A || {});
  const hit = keys.find(function (k) { return k.toLowerCase() === name.toLowerCase(); });
  const v = hit ? A[hit] : undefined;
  return (v === undefined || v === null || v === "") ? def : v;
}

const USER = String(gv("username", "")).trim();
const PASS = String(gv("password", "")).trim();
const RENEW = String(gv("renew", "true")).toLowerCase() !== "false";
const RENEW_DAYS = Math.max(1, Math.min(365, parseInt(gv("renew_days", 30), 10) || 30));
const NOTIFY = String(gv("notify", "true")).toLowerCase() !== "false";

// ---------- 工具 ----------
function log(s) { console.log("[flixpilot] " + s); }
function notify(title, body) {
  if (!NOTIFY) { log("通知(已关闭): " + title + " | " + body.replace(/\n/g, " / ")); return; }
  $notification.post(title, "", body);
}
// 站点按北京时间记 lastSignIn，这里统一用 UTC+8 的日期串
function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function daysLeftOf(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}
function fmtDate(iso) {
  if (!iso) return "未知";
  try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return String(iso); }
}

// ---------- HTTP ----------
function captureToken(resp) {
  try {
    const h = (resp && resp.headers) || {};
    let sc = h["set-cookie"] || h["Set-Cookie"] || "";
    if (Array.isArray(sc)) sc = sc.join("\n");
    sc = String(sc);
    if (!sc) return;
    const m = sc.match(/auth-token=([^;,\s]+)/) || sc.match(/token=([^;,\s]+)/);
    if (!m) return;
    const old = $persistentStore.read(TKEY);
    if (m[1] && m[1] !== old) {
      $persistentStore.write(m[1], TKEY);
      log("auth-token 已更新");
    }
  } catch (e) {}
}

function api(method, path, body) {
  return new Promise(function (resolve) {
    const opts = {
      url: BASE + path,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": UA,
        "Origin": BASE,
        "Referer": BASE + "/home"
      },
      "auto-cookie": true,
      timeout: 20000
    };
    const tok = $persistentStore.read(TKEY);
    if (tok) opts.headers.Cookie = "auth-token=" + tok;
    if (body !== undefined) opts.body = JSON.stringify(body);

    const cb = function (err, resp, data) {
      if (err) { resolve({ ok: false, status: 0, err: String(err), json: null, raw: "" }); return; }
      captureToken(resp);
      let j = null;
      try { j = JSON.parse(data); } catch (e) {}
      const st = resp ? resp.status : 0;
      resolve({ ok: st >= 200 && st < 300, status: st, json: j, raw: typeof data === "string" ? data : "" });
    };
    if (method === "GET") $httpClient.get(opts, cb);
    else $httpClient.post(opts, cb);
  });
}

// ---------- 登录 ----------
async function fetchMe() {
  const r = await api("GET", "/api/auth/me");
  if (r.json && r.json.authenticated && r.json.user) return r.json.user;
  return null;
}

async function login() {
  if (!USER || !PASS) { log("未配置账号或密码"); return null; }
  log("登录中: " + USER);
  const r = await api("POST", "/api/auth/login", { username: USER, password: PASS });
  if (!r.ok) {
    log("登录失败: HTTP " + r.status + " " + (r.raw || r.err || "").slice(0, 200));
    return null;
  }
  if (r.json && r.json.success === false) {
    log("登录被拒: " + (r.json.error || r.json.message || ""));
    return null;
  }
  const u = await fetchMe();
  if (!u) log("登录后校验失败（cookie 未生效）");
  return u;
}

async function ensureUser() {
  const u = await fetchMe();
  if (u) { log("复用已有会话: " + u.username); return u; }
  log("会话无效，重新登录");
  return await login();
}

// ---------- 签到 ----------
async function doSignIn(user) {
  const cfgR = await api("GET", "/api/auth/sign-in");
  const cfg = (cfgR.json && typeof cfgR.json === "object") ? cfgR.json : {};
  const base = (cfg.base && typeof cfg.base.popcorn === "number") ? cfg.base.popcorn : null;
  if (cfg.enabled === false) return { type: "disabled", text: "站点已关闭签到" };

  const last = user && user.lastSignIn ? String(user.lastSignIn).slice(0, 10) : "";
  if (last && last === todayCN()) {
    return { type: "already", text: "今日已签到", popcorn: user.popcorn, streak: user.signInStreak };
  }

  const before = (user && typeof user.popcorn === "number") ? user.popcorn : null;
  const r = await api("POST", "/api/auth/sign-in");
  const j = r.json || {};
  const msg = String(j.message || "");

  if (j.success) {
    const gained = (typeof j.popcorn === "number" && before !== null) ? (j.popcorn - before) : (base != null ? base : null);
    return {
      type: "success",
      text: "签到成功",
      gained: gained,
      popcorn: (typeof j.popcorn === "number") ? j.popcorn : null,
      streak: (typeof j.streak === "number") ? j.streak : null
    };
  }
  if (/已签到|已经签到/.test(msg)) {
    return { type: "already", text: "今日已签到（接口返回）", popcorn: (typeof j.popcorn === "number") ? j.popcorn : null, streak: j.streak };
  }
  return { type: "fail", text: msg || ("签到失败 HTTP " + r.status + (j.error ? " " + j.error : "")) };
}

// ---------- 续期 ----------
function pickMembershipItem(items, popcorn) {
  const list = (items || []).filter(function (it) {
    return it && it.enabled !== false && it.rewardType === "membership_days" &&
      String(it.payMethod || "popcorn") === "popcorn" && Number(it.rewardValue) > 0 && Number(it.price) > 0;
  });
  if (!list.length) return null;
  // 优先「月卡」（30 天档）；没有月卡再退到每天单价最低的档位
  const monthly = list.find(function (it) {
    const d = Number(it.rewardValue);
    return (d >= 28 && d <= 31) || /月卡/.test(String(it.name || ""));
  });
  if (monthly) return monthly;
  list.sort(function (a, b) {
    const pa = Number(a.price) / Number(a.rewardValue);
    const pb = Number(b.price) / Number(b.rewardValue);
    if (Math.abs(pa - pb) > 1e-9) return pa - pb;
    return Number(b.rewardValue) - Number(a.rewardValue);
  });
  return list.find(function (it) { return Number(it.price) <= popcorn; }) || list[0];
}

async function doRenew(user) {
  const left = daysLeftOf(user && user.membershipExpiry);
  if (left === null) return { type: "unknown", text: "会员到期时间缺失，跳过续期" };

  const head = "会员剩 " + left + " 天（" + fmtDate(user.membershipExpiry) + " 到期）";
  if (!RENEW) return { type: "off", text: head };
  if (left > RENEW_DAYS) return { type: "ok", text: head };

  // 需要续期
  let popcorn = (typeof user.popcorn === "number") ? user.popcorn : 0;
  let days = left;
  const bought = [];
  let err = "";

  for (let i = 0; i < 3 && days <= RENEW_DAYS; i++) {
    const shopR = await api("GET", "/api/shop");
    if (!shopR.ok || !shopR.json) { err = "商城读取失败 HTTP " + shopR.status; break; }
    const wallet = shopR.json.wallet || {};
    popcorn = (typeof wallet.popcorn === "number") ? wallet.popcorn : popcorn;

    const item = pickMembershipItem(shopR.json.items, popcorn);
    if (!item) { err = "商城里没有可用的会员商品"; break; }
    const price = Number(item.price);
    const val = Number(item.rewardValue || 0);
    if (popcorn < price) { err = "爆米花不足（" + popcorn + " < " + price + "），需手动处理"; break; }

    log("续期购买: " + item.name + " " + price + " 爆米花 → +" + val + " 天");
    const br = await api("POST", "/api/shop", { itemId: item.id });
    const bj = br.json || {};
    if (!br.ok) { err = "购买失败: " + (bj.error || ("HTTP " + br.status)); break; }

    bought.push(item.name + "(" + price + "爆米花/+ " + val + "天)");
    if (bj.wallet && typeof bj.wallet.popcorn === "number") popcorn = bj.wallet.popcorn;
    days += val;
    if (i === 0) await new Promise(function (r) { setTimeout(r, 500); });
  }

  let text = head;
  if (bought.length) text += "\n已续期：" + bought.join("、") + " → 约剩 " + days + " 天（爆米花余 " + popcorn + "）";
  if (err) text += "\n⚠️ " + err;
  return { type: err ? (bought.length ? "warn" : "fail") : "renewed", text: text, renewed: bought.length > 0 };
}

// ---------- 主流程 ----------
(async function main() {
  if (!USER || !PASS) {
    notify("乐蛙影视 · 未配置", "请在插件设置里填账号和密码");
    $done();
    return;
  }

  let user = await ensureUser();
  if (!user) {
    notify("乐蛙影视 · 登录失败", "账号或密码错误，或站点暂时不可用（" + todayCN() + "）");
    $done();
    return;
  }

  const lines = [];
  lines.push("账号：" + (user.username || USER));

  // 1) 签到
  const si = await doSignIn(user);
  if (si.type === "success") {
    lines.push("签到：+" + (si.gained != null ? si.gained : "?") + " 爆米花，连续 " + (si.streak != null ? si.streak : "?") + " 天");
    log("签到成功");
  } else if (si.type === "already") {
    lines.push("签到：今日已签" + (si.streak ? "，连续 " + si.streak + " 天" : ""));
  } else if (si.type === "disabled") {
    lines.push("签到：" + si.text);
  } else {
    lines.push("签到：失败 - " + si.text);
    log("签到失败: " + si.text);
  }

  // 刷新余额（签到返回值可能缺字段）
  const me2 = await fetchMe();
  if (me2) user = me2;

  // 2) 续期（到期前 RENEW_DAYS 天内自动用积分买月卡）
  const rn = await doRenew(user);
  lines.push(rn.text);

  // 末尾用最新余额（续期会消耗积分）
  const me3 = await fetchMe();
  const popcornFinal = me3 ? me3.popcorn : (typeof user.popcorn === "number" ? user.popcorn : null);
  if (popcornFinal != null) lines.push("爆米花：" + popcornFinal);

  const body = lines.join("\n");
  log(body);
  const title = rn.renewed ? "乐蛙影视 · 已自动续期" : (si.type === "fail" ? "乐蛙影视 · 签到异常" : "乐蛙影视每日任务");
  notify(title, body);
  $done();
})().catch(function (e) {
  log("异常: " + (e && e.stack ? e.stack : e));
  notify("乐蛙影视 · 脚本异常", String(e).slice(0, 120));
  $done();
});
