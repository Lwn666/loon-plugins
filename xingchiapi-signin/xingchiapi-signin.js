/*
 * 星驰API公益站 每日签到（Loon cron / script v1 兼容）
 *
 * 接口（实测 2026-11-20）：
 *   GET  /api/v1/user/checkin  -> data{enabled,amount,claimed_today,today,total_count,total_amount,next_claim_at}
 *   POST /api/v1/user/checkin  -> data{amount,new_balance,status{...}}；重复签到 409 CHECKIN_ALREADY_CLAIMED
 *   POST /api/v1/auth/refresh  {"refresh_token":"rt_..."} -> data{access_token,refresh_token,expires_in:86400}
 * 鉴权：Authorization: Bearer <access_token>(JWT，24h)；登录接口强制 Turnstile，无法用账号密码登录
 *
 * 两种令牌模式（互斥）：
 *   manual  —— 参数里填了 RefreshToken：用一个"独立会话"的 rt 每天续期，不碰浏览器那份（推荐长期用）
 *   capture —— 参数留空：用 http-response 抓包存下的站点令牌，24h 内开过站点即可签到
 * 行为：已签到静默；签到成功/失败才推送
 */

var BASE = "https://api.xingchiapi.com/api/v1";
var UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

var K_AT = "xingchiapi_at";              // access_token（两种模式共用）
var K_RT_CAPTURE = "xingchiapi_rt_capture";  // 抓包得到的 rt（属于浏览器会话）
var K_RT_PLUGIN = "xingchiapi_rt_plugin";    // 插件自己续期轮换出来的 rt（独立会话）

var arg = ($argument && typeof $argument === "object") ? $argument : {};
var ARG_AT = arg.AccessToken ? String(arg.AccessToken).trim() : "";
var ARG_RT = arg.RefreshToken ? String(arg.RefreshToken).trim() : "";

function log(m) { console.log("[xingchi] " + m); }

function push(title, sub, body) {
  console.log("[xingchi] 通知: " + title + " | " + sub + " | " + body);
  $notification.post(title, sub, body);
}

function isPlaceholder(v) {
  return !v || v.indexOf("在这里") === 0 || v.indexOf("<") === 0;
}

var MANUAL = !isPlaceholder(ARG_RT) && ARG_RT.length >= 20;

function store(key) {
  try {
    var v = $persistentStore.read(key);
    return v ? String(v).trim() : "";
  } catch (e) { return ""; }
}

function save(key, val) {
  if (!val) { return; }
  try { $persistentStore.write(String(val), key); } catch (e) { log("写 store 失败 " + key + ": " + e); }
}

function getAt() {
  var at = store(K_AT);
  if (!at && !isPlaceholder(ARG_AT)) { at = ARG_AT; }
  return at;
}

/* manual 模式只用插件自己的 rt（避免消费浏览器那份）；capture 模式用抓包 rt */
function getRt() {
  if (MANUAL) {
    return store(K_RT_PLUGIN) || ARG_RT;
  }
  return store(K_RT_CAPTURE) || (!isPlaceholder(ARG_RT) ? ARG_RT : "");
}

function saveRt(v) {
  save(MANUAL ? K_RT_PLUGIN : K_RT_CAPTURE, v);
}

function parse(data) {
  try { return JSON.parse(data || "{}"); } catch (e) { return {}; }
}

function num(v, d) {
  var n = Number(v);
  return isNaN(n) ? (d === undefined ? 0 : d) : n;
}

function fmt(v) {
  return String(Math.round(num(v, 0) * 100) / 100);
}

function finish() {
  try { $done({}); } catch (e) {}
}

/* ---------- 主流程 ---------- */

function main() {
  var at = getAt();
  var rt = getRt();
  log("模式=" + (MANUAL ? "manual(独立会话)" : "capture(抓包)") +
    " at=" + (at ? "有(" + at.length + ")" : "无") + " rt=" + (rt ? "有(" + rt.length + ")" : "无"));

  if (!at && !rt) {
    push("星驰API 签到未配置", "没有可用令牌",
      "打开一次 api.xingchiapi.com 让插件自动抓取令牌；或在插件参数里填一个独立会话的 RefreshToken");
    return finish();
  }
  getStatus(at, true);
}

function getStatus(at, allowRefresh) {
  if (!at) { return doRefresh("no-at"); }
  $httpClient.get({
    url: BASE + "/user/checkin",
    headers: { "Authorization": "Bearer " + at, "Accept": "application/json", "User-Agent": UA },
    timeout: 12000
  }, function (err, resp, data) {
    var code = resp ? resp.status : -1;
    if (code === 200) {
      return handleStatus(parse(data));
    }
    if (code === 401 || code === 403) {
      log("access_token 已失效（HTTP " + code + "），尝试刷新");
      return doRefresh(allowRefresh ? "unauthorized" : "again");
    }
    var msg = err ? String(err) : ("HTTP " + code);
    push("星驰API 签到查询失败", msg, String(data || "").slice(0, 160));
    finish();
  });
}

function doRefresh(reason) {
  var rt = getRt();
  if (!rt) {
    push("星驰API 令牌已过期", MANUAL ? "独立会话 rt 缺失" : "需要重新登录站点",
      MANUAL
        ? "插件参数里的 RefreshToken 已失效，请重新生成一个填进去"
        : "打开一次 api.xingchiapi.com 并登录，令牌会自动抓取；或在参数里填独立会话的 RefreshToken");
    return finish();
  }
  log("刷新令牌（原因: " + reason + "，模式: " + (MANUAL ? "manual" : "capture") + "）");
  $httpClient.post({
    url: BASE + "/auth/refresh",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA },
    body: JSON.stringify({ refresh_token: rt }),
    timeout: 12000
  }, function (err, resp, data) {
    var code = resp ? resp.status : -1;
    var j = parse(data);
    var d = j.data || j;
    if (code !== 200 || !d.access_token) {
      var msg = err ? String(err) : ("HTTP " + code + " " + (j.message || j.code || ""));
      log("刷新失败: " + msg);
      push("星驰API 令牌刷新失败", String(code),
        (MANUAL ? "独立会话 rt 已失效，请重新登录站点生成新的（" : "请重新登录 api.xingchiapi.com 以更新令牌（") +
        msg.slice(0, 80) + "）");
      return finish();
    }
    save(K_AT, d.access_token);
    saveRt(d.refresh_token);   // rt 一次性轮换：旧 rt 已作废，必须回写
    log("刷新成功，新令牌已写入 store（expires_in=" + (d.expires_in || "-") + "s）");
    getStatus(d.access_token, false);
  });
}

function handleStatus(j) {
  if (j.code !== 0 && j.code !== 200) {
    push("星驰API 签到状态异常", String(j.code || "-"), String(j.message || "").slice(0, 160));
    return finish();
  }
  var st = j.data || {};
  if (st.enabled === false) {
    log("站点当前未开启签到");
    return finish();
  }
  if (st.claimed_today) {
    log("今天已签到（" + (st.last_checkin_date || st.today || "-") + "），静默退出");
    return finish();
  }
  log("未签到，准备领取 " + fmt(st.amount) + "，累计 " + num(st.total_count) + " 天");
  claim(st);
}

function claim(st) {
  var at = getAt();
  $httpClient.post({
    url: BASE + "/user/checkin",
    headers: {
      "Authorization": "Bearer " + at,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": UA
    },
    body: "{}",
    timeout: 15000
  }, function (err, resp, data) {
    var code = resp ? resp.status : -1;
    var j = parse(data);
    if (code === 200 && (j.code === 0 || j.code === 200)) {
      var d = j.data || {};
      var s = d.status || st || {};
      var got = d.amount !== undefined ? d.amount : s.amount;
      push("星驰API 签到成功", "🌟 +" + fmt(got),
        "今日 +" + fmt(got) + "｜累计 " + num(s.total_count) + " 天 / 共 " + fmt(s.total_amount) +
        "｜余额 " + fmt(d.new_balance));
      return finish();
    }
    if (code === 409 || j.reason === "CHECKIN_ALREADY_CLAIMED") {
      log("已签到（409），静默退出");
      return finish();
    }
    if (code === 401 || code === 403) {
      log("签到时鉴权失效，尝试刷新后重试");
      return doRefresh("claim-unauthorized");
    }
    var msg = err ? String(err) : ("HTTP " + code + " " + (j.message || ""));
    push("星驰API 签到失败", String(code), msg.slice(0, 160));
    finish();
  });
}

main();
