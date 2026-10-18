/**
 * 淘图 EmbyPulse 社区 · 每日签到 + 刮刮乐
 * 站点: https://ue2.taotu.ink
 *
 * 流程: 登录(session_id) -> 每日签到 -> 逐张购买刮刮卡 -> 刮开全部格子 -> 汇总通知
 * 接口: POST /api/requests/auth          {username,password}
 *       GET  /api/requests/check
 *       POST /api/user/points/checkin
 *       GET  /api/points/config
 *       POST /api/scratch/buy
 *       POST /api/scratch/reveal         {cell_index}
 *
 * 用法: Loon 插件 cron 定时触发; 也可在 Loon「脚本」里手动运行一次
 */

const BASE = "https://ue2.taotu.ink";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SKEY = "taotu_session_id";
const DKEY = "taotu_done_day"; // 记录已完成的日期, 防重复刮

// ---------- 参数解析 ($argument 可能是对象 / JSON 字符串 / 旧数组) ----------
function parseArg() {
  let a = typeof $argument !== "undefined" ? $argument : undefined;
  if (typeof a === "string") {
    try { a = JSON.parse(a); } catch (e) { a = {}; }
  }
  if (Array.isArray(a)) {
    // 旧版数组: 按插件声明顺序 [username, password, max_cards, notify]
    return { username: a[0], password: a[1], max_cards: a[2], notify: a[3] };
  }
  return a && typeof a === "object" ? a : {};
}
const A = parseArg();
function gv(name, def) {
  const keys = Object.keys(A || {});
  const hit = keys.find(k => k.toLowerCase() === name.toLowerCase());
  const v = hit ? A[hit] : undefined;
  return (v === undefined || v === null || v === "") ? def : v;
}

const USER = String(gv("username", "")).trim();
const PASS = String(gv("password", "")).trim();
const MAX_CARDS = Math.min(20, Math.max(1, parseInt(gv("max_cards", 20), 10) || 20));
const NOTIFY = String(gv("notify", "true")).toLowerCase() !== "false";

// ---------- 工具 ----------
function log(s) { console.log("[taotu] " + s); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function notify(title, body) {
  if (!NOTIFY) { log("通知(已关闭): " + title + " | " + body); return; }
  $notification.post(title, "", body);
}
function today() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // 东八区
  return d.toISOString().slice(0, 10);
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
      "auto-redirect": true,
      timeout: 15000
    };
    const sid = $persistentStore.read(SKEY);
    if (sid) opts.headers.Cookie = "session_id=" + sid;
    if (body !== undefined) opts.body = JSON.stringify(body);

    const cb = function (err, resp, data) {
      if (err) return resolve({ ok: false, err: String(err) });
      // 从 Set-Cookie 里抓 session_id 持久化
      try {
        const h = resp && resp.headers ? resp.headers : {};
        let sc = h["set-cookie"] || h["Set-Cookie"] || "";
        if (Array.isArray(sc)) sc = sc.join("\n");
        const m = String(sc).match(/session_id=([^;,\s]+)/);
        if (m && m[1] && m[1] !== sid) {
          $persistentStore.write(m[1], SKEY);
          log("已更新 session_id");
        }
      } catch (e) {}
      let j = null;
      try { j = JSON.parse(data); } catch (e) {}
      resolve({ ok: resp && resp.status === 200, status: resp ? resp.status : 0, json: j, raw: data });
    };

    if (method === "GET") $httpClient.get(opts, cb);
    else $httpClient.post(opts, cb);
  });
}

// ---------- 登录 ----------
async function ensureLogin() {
  let chk = await api("GET", "/api/requests/check");
  if (chk.json && chk.json.status === "success") {
    log("复用已有 session: " + ((chk.json.user && chk.json.user.Name) || "?"));
    return true;
  }
  log("session 无效, 重新登录");
  const lg = await api("POST", "/api/requests/auth", { username: USER, password: PASS });
  if (!lg.json || lg.json.status !== "success") {
    log("登录失败: " + (lg.raw || lg.err || "").slice(0, 200));
    return false;
  }
  chk = await api("GET", "/api/requests/check");
  if (!chk.json || chk.json.status !== "success") {
    log("登录后校验失败: " + (chk.raw || "").slice(0, 200));
    return false;
  }
  log("登录成功: " + ((chk.json.user && chk.json.user.Name) || "?"));
  return true;
}

// ---------- 主流程 ----------
(async function main() {
  if (!USER || !PASS) {
    notify("淘图签到 · 未配置", "请在插件设置里填写账号和密码");
    $done();
    return;
  }

  if (!(await ensureLogin())) {
    notify("淘图签到 · 登录失败", "账号或密码错误，或站点暂时不可用");
    $done();
    return;
  }

  const lines = [];
  let points = null;

  // 1) 每日签到
  const info0 = await api("GET", "/api/user/points/info");
  if (info0.json && info0.json.status === "success" && info0.json.data) {
    points = info0.json.data.points;
  }
  if (info0.json && info0.json.status === "success" && info0.json.data && info0.json.data.has_checked_in) {
    lines.push("签到：今日已签过");
    log("今日已签到, 跳过");
  } else {
    const ck = await api("POST", "/api/user/points/checkin");
    if (ck.json && ck.json.status === "success") {
      const rw = ck.json.reward || 0;
      if (ck.json.balance != null) points = ck.json.balance;
      lines.push("签到：+" + rw + " 分");
      log("签到成功 +" + rw);
    } else {
      lines.push("签到：" + ((ck.json && ck.json.message) || "失败"));
      log("签到失败: " + (ck.raw || "").slice(0, 200));
    }
    await sleep(300);
  }

  // 2) 读配置 (每日次数 / 单价)
  const cfgR = await api("GET", "/api/points/config");
  const cfg = (cfgR.json && cfgR.json.status === "success" && cfgR.json.data) ? cfgR.json.data : {};
  const maxPerDay = parseInt(cfg.web_scratch_max_per_day || "20", 10) || 20;
  const cost = parseInt(cfg.web_scratch_cost || "100", 10) || 100;
  const limit = Math.min(MAX_CARDS, maxPerDay);

  // 3) 刮刮乐
  let cards = 0, spent = 0, won = 0, stopMsg = "";
  for (let i = 0; i < limit; i++) {
    const b = await api("POST", "/api/scratch/buy");
    if (!b.json || b.json.status !== "success") {
      stopMsg = (b.json && b.json.message) || ("HTTP " + b.status + (b.err ? " " + b.err : ""));
      log("购买停止: " + stopMsg);
      break;
    }
    cards++;
    spent += cost;
    if (b.json.new_points != null) points = b.json.new_points;
    const grid = b.json.grid || [];
    const n = grid.length || 12;
    let fail = 0;
    for (let k = 0; k < n; k++) {
      const rv = await api("POST", "/api/scratch/reveal", { cell_index: k });
      if (rv.json && rv.json.status === "success") {
        if (rv.json.matched && rv.json.reward > 0) won += rv.json.reward;
        if (rv.json.new_points != null) points = rv.json.new_points;
      } else {
        fail++;
      }
      await sleep(120);
    }
    log("第 " + cards + " 张: 累计中奖 " + won + (fail ? " (失败格 " + fail + ")" : ""));
    // 保护: 整张卡全部失败 -> 接口结构可能变了, 立即停止避免白扣积分
    if (fail >= n) {
      stopMsg = "刮开接口异常，已中止";
      break;
    }
    await sleep(200);
  }

  if (cards > 0) {
    lines.push("刮刮乐：" + cards + " 张，花费 " + spent + " 分，中奖 " + won + " 分，净 " + (won - spent >= 0 ? "+" : "") + (won - spent));
  } else {
    lines.push("刮刮乐：" + (stopMsg || "未执行"));
  }
  if (points != null) lines.push("当前积分：" + points);

  const body = lines.join("\n");
  log(body);
  // 无任何收益变化且刮不了(次数用完)时仍通知, 让用户知道脚本跑过; 若想静默可关 notify
  notify("淘图每日任务", body);
  if (cards > 0) $persistentStore.write(today(), DKEY);
  $done();
})().catch(function (e) {
  log("异常: " + (e && e.stack ? e.stack : e));
  notify("淘图每日任务 · 异常", String(e).slice(0, 120));
  $done();
});
