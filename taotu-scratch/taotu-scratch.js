/**
 * 淘图社区（EmbyPulse）· 每日签到 + 会员到期自动续期 + 可选刮刮乐
 * 站点: https://ue2.taotu.ink
 *
 * 接口（旧版面板，2026-11-28 回退后的现网版本）:
 *   POST /api/requests/auth {username,password}   -> Set-Cookie: session_id
 *   GET  /api/requests/check                      -> {status:'success', user:{Id,Name,expire_date}}
 *   GET  /api/user/points/info                    -> {status:'success', data:{points,has_checked_in,config{...}}}
 *   POST /api/user/points/checkin                 -> {status, reward, balance}
 *   GET  /api/points/config                       -> {status:'success', data:{store_items(JSON字符串), enable_web_scratch, web_scratch_cost, ...}}
 *   POST /api/user/points/redeem {item_id,request_id} -> {status, balance, title, message, replayed}
 *   POST /api/scratch/buy | /api/scratch/reveal {cell_index}
 *
 * 流程: 登录/复用 session -> 签到 -> 会员剩余天数不足阈值时用积分买月卡续期 -> （站点开启时）刮刮乐 -> 汇总通知
 */

const BASE = "https://ue2.taotu.ink";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SKEY = "taotu_session_id";
const RKEY = "taotu_redeem_pending";

// ---------- 参数解析（对象 / JSON 字符串 / 数组顺序） ----------
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
    const flat = a.map(function (v) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const ks = Object.keys(v);
        return ks.length ? v[ks[0]] : undefined;
      }
      return v;
    });
    return { username: flat[0], password: flat[1], renew: flat[2], renew_days: flat[3], max_cards: flat[4], notify: flat[5] };
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
const MAX_CARDS = Math.max(0, Math.min(20, parseInt(gv("max_cards", 0), 10) || 0));
const NOTIFY = String(gv("notify", "true")).toLowerCase() !== "false";

// ---------- 工具 ----------
function log(s) { console.log("[taotu] " + s); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function notify(title, body) {
  if (!NOTIFY) { log("通知(已关闭): " + title + " | " + body.replace(/\n/g, " / ")); return; }
  $notification.post(title, "", body);
}
function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
// 返回剩余天数；永久/未知返回 null
function daysLeftOf(expireDate) {
  if (!expireDate) return null;
  const s = String(expireDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;          // 永久 / 未知 等
  if (/^(3000|2099)/.test(s)) return null;                  // 站点用超远日期表示永久
  const d = new Date(s.slice(0, 10) + "T00:00:00+08:00").getTime();
  const t = new Date(todayCN() + "T00:00:00+08:00").getTime();
  if (!isFinite(d)) return null;
  return Math.round((d - t) / 86400000);
}
function uuid() {
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
}

// ---------- HTTP ----------
function api(method, path, body) {
  return new Promise(function (resolve) {
    const opts = {
      url: BASE + path,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": UA,
        "Origin": BASE,
        "Referer": BASE + "/?tab=profile"
      },
      "auto-cookie": true,
      timeout: 20000
    };
    const sid = $persistentStore.read(SKEY);
    if (sid) opts.headers.Cookie = "session_id=" + sid;
    if (body !== undefined) opts.body = JSON.stringify(body);

    const cb = function (err, resp, data) {
      if (err) { resolve({ ok: false, status: 0, err: String(err), json: null, raw: "" }); return; }
      try {
        const h = (resp && resp.headers) || {};
        let sc = h["set-cookie"] || h["Set-Cookie"] || "";
        if (Array.isArray(sc)) sc = sc.join("\n");
        const m = String(sc).match(/session_id=([^;,\s]+)/);
        if (m && m[1] && m[1] !== sid) { $persistentStore.write(m[1], SKEY); log("已更新 session_id"); }
      } catch (e) {}
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
async function checkSession() {
  const r = await api("GET", "/api/requests/check");
  if (r.json && r.json.status === "success" && r.json.user) return r.json;
  return null;
}

async function login() {
  if (!USER || !PASS) { log("未配置账号或密码"); return null; }
  log("登录中: " + USER);
  const r = await api("POST", "/api/requests/auth", { username: USER, password: PASS });
  const j = r.json || {};
  if (!r.ok || j.status !== "success") {
    log("登录失败: " + (j.message || r.raw || r.err || "").slice(0, 200));
    return null;
  }
  const c = await checkSession();
  if (!c) log("登录后校验失败");
  return c;
}

async function ensureSession() {
  let c = await checkSession();
  if (c) { log("复用已有 session: " + ((c.user && c.user.Name) || "?")); return c; }
  log("session 无效，重新登录");
  return await login();
}

// ---------- 签到 ----------
async function doCheckIn() {
  const info = await api("GET", "/api/user/points/info");
  const d = (info.json && info.json.status === "success" && info.json.data) ? info.json.data : null;
  const points = d ? Number(d.points || 0) : null;
  if (d && d.has_checked_in) return { type: "already", points: points, text: "今日已签到" };

  const r = await api("POST", "/api/user/points/checkin");
  const j = r.json || {};
  if (j.status === "success") {
    const rw = (j.reward != null) ? j.reward : null;
    return { type: "success", gained: rw, points: (j.balance != null ? j.balance : points), text: "签到成功" + (rw != null ? " +" + rw + " 积分" : "") };
  }
  const msg = String(j.message || j.detail || "");
  if (/已签到|已经签到/.test(msg)) return { type: "already", points: points, text: "今日已签到（接口返回）" };
  return { type: "fail", points: points, text: msg || ("签到失败 HTTP " + r.status) };
}

// ---------- 积分补给站 ----------
function parseStore(cfgData) {
  let items = cfgData ? cfgData.store_items : null;
  if (typeof items === "string") { try { items = JSON.parse(items); } catch (e) { items = null; } }
  return Array.isArray(items) ? items : [];
}

function pickRenewItem(items, points) {
  const renew = items.filter(function (it) {
    return it && it.type === "renew" && Number(it.val) > 0 && Number(it.cost) > 0;
  });
  if (!renew.length) return null;
  // 优先月卡（28~31 天或名称精确为「月卡」；不能用 /月卡/ 正则，会误中「半月卡」）
  const monthly = renew.find(function (it) { const v = Number(it.val); return v >= 28 && v <= 31; }) ||
    renew.find(function (it) { return String(it.name || "").trim() === "月卡"; });
  if (monthly) return monthly;
  renew.sort(function (a, b) { return (a.cost / a.val) - (b.cost / b.val); });
  return renew.find(function (it) { return Number(it.cost) <= points; }) || renew[0];
}

async function doRenew(session, points) {
  const expire = session && session.user ? session.user.expire_date : null;
  const left = daysLeftOf(expire);
  if (left === null) return { type: "skip", text: "会员：到期时间未知或永久（" + (expire || "无") + "），跳过续期" };

  const head = "会员：剩 " + left + " 天（" + String(expire).slice(0, 10) + " 到期）";
  if (!RENEW) return { type: "off", text: head };
  if (left > RENEW_DAYS) return { type: "ok", text: head };

  const cfgR = await api("GET", "/api/points/config");
  const cfgData = (cfgR.json && cfgR.json.status === "success") ? cfgR.json.data : null;
  const item = pickRenewItem(parseStore(cfgData), points || 0);
  if (!item) return { type: "fail", text: head + "\n⚠️ 积分补给站里没有可用的续期商品" };

  const cost = Number(item.cost);
  const val = Number(item.val);
  if ((points || 0) < cost) {
    return { type: "warn", text: head + "\n⚠️ 积分不足（" + (points || 0) + " < " + cost + "），本次未续期" };
  }

  // 幂等：同商品未确认的请求沿用同一个 request_id，避免重复扣分
  let pending = null;
  try { pending = JSON.parse($persistentStore.read(RKEY) || "null"); } catch (e) { pending = null; }
  const fresh = pending && pending.itemId === item.id && (Date.now() - (pending.ts || 0) < 12 * 3600 * 1000);
  const reqId = fresh ? pending.reqId : uuid();
  if (!fresh) $persistentStore.write(JSON.stringify({ itemId: item.id, reqId: reqId, ts: Date.now() }), RKEY);

  log("续期购买: " + item.name + " " + cost + " 积分 → +" + val + " 天");
  const r = await api("POST", "/api/user/points/redeem", { item_id: item.id, request_id: reqId });
  const j = r.json || {};

  if (j.status === "success" || j.new_expire) {
    $persistentStore.write("", RKEY);
    let left2 = j.new_expire ? daysLeftOf(j.new_expire) : null;
    if (left2 === null) {
      const c2 = await checkSession();
      left2 = c2 ? daysLeftOf(c2.user && c2.user.expire_date) : null;
    }
    const bal = (j.balance != null) ? j.balance : null;
    const syncNote = j.permission_sync === "pending" ? "（Emby 权限同步待重试，站点会自动补）" : "";
    return {
      type: "renewed",
      text: head + "\n已续期：" + item.name + "（-" + cost + " 积分" + (bal != null ? "，余 " + bal : "") + "）" +
        (j.new_expire ? " → 到期 " + String(j.new_expire).slice(0, 10) : "") +
        (left2 != null ? "（剩 " + left2 + " 天）" : "") +
        (j.replayed ? "（幂等重放，未重复扣分）" : "") + syncNote
    };
  }
  // 失败：保留 request_id 供下次安全重试（服务端按 request_id 去重）
  return { type: "fail", text: head + "\n⚠️ 续期失败：" + (j.message || j.detail || ("HTTP " + r.status)) };
}

// ---------- 刮刮乐（站点开启时才跑） ----------
async function doScratch() {
  if (MAX_CARDS <= 0) return null;
  const cfgR = await api("GET", "/api/points/config");
  const d = (cfgR.json && cfgR.json.status === "success") ? cfgR.json.data : null;
  if (!d) return "刮刮乐：配置读取失败，跳过";
  if (String(d.enable_web_scratch) !== "1") return "刮刮乐：站点未开启，跳过";
  const cost = parseInt(d.web_scratch_cost, 10) || 100;
  const limit = Math.min(MAX_CARDS, parseInt(d.web_scratch_max_per_day, 10) || 20);

  let cards = 0, spent = 0, won = 0, stop = "";
  for (let i = 0; i < limit; i++) {
    const b = await api("POST", "/api/scratch/buy");
    const bj = b.json || {};
    if (bj.status !== "success") { stop = bj.message || ("HTTP " + b.status); break; }
    cards++; spent += cost;
    const grid = bj.grid || [];
    const n = grid.length || 12;
    let fail = 0;
    for (let k = 0; k < n; k++) {
      const rv = await api("POST", "/api/scratch/reveal", { cell_index: k });
      if (rv.json && rv.json.status === "success") { if (rv.json.matched && rv.json.reward > 0) won += rv.json.reward; }
      else fail++;
      await sleep(120);
    }
    if (fail >= n) { stop = "刮开接口异常，已中止"; break; }
    await sleep(200);
  }
  if (!cards) return "刮刮乐：" + (stop || "未执行");
  return "刮刮乐：" + cards + " 张，花 " + spent + " 分，中 " + won + " 分，净 " + (won - spent >= 0 ? "+" : "") + (won - spent);
}

// ---------- 主流程 ----------
(async function main() {
  if (!USER || !PASS) {
    notify("淘图 · 未配置", "请在插件设置里填账号和密码");
    $done();
    return;
  }

  let session = await ensureSession();
  if (!session) {
    notify("淘图 · 登录失败", "账号或密码错误，或站点暂时不可用（" + todayCN() + "）");
    $done();
    return;
  }

  const lines = ["账号：" + ((session.user && session.user.Name) || USER)];

  // 1) 签到
  const ci = await doCheckIn();
  lines.push("签到：" + (ci.type === "success" ? ci.text : (ci.type === "already" ? "今日已签到" : "失败 - " + ci.text)));
  let points = ci.points;

  // 2) 续期
  const rn = await doRenew(session, points);
  lines.push(rn.text);

  // 3) 刮刮乐（可选）
  const sc = await doScratch();
  if (sc) lines.push(sc);

  const body = lines.join("\n");
  log(body);
  let title = "淘图每日任务";
  if (rn.type === "renewed") title = "淘图 · 已自动续期";
  else if (ci.type === "fail" || rn.type === "fail") title = "淘图 · 有异常";
  notify(title, body);
  $done();
})().catch(function (e) {
  log("异常: " + (e && e.stack ? e.stack : e));
  notify("淘图 · 脚本异常", String(e).slice(0, 120));
  $done();
});
