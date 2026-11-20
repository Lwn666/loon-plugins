/*
 * 星驰API公益站 每日签到（Loon cron / script v1 兼容）
 *
 * 接口（实测 2026-11-20）：
 *   GET  /api/v1/user/checkin  -> data{enabled,amount,claimed_today,today,total_count,total_amount,next_claim_at}
 *   POST /api/v1/user/checkin  -> data{amount,new_balance,status{...}}；重复签到 409 CHECKIN_ALREADY_CLAIMED
 *   POST /api/v1/auth/refresh  {"refresh_token":"rt_..."} -> data{access_token,refresh_token,expires_in:86400}
 * 鉴权：Authorization: Bearer <access_token>(JWT，24h)
 *
 * 令牌来源优先级：persistentStore(抓包脚本写入) > 插件参数
 * 行为：已签到静默；签到成功/失败才推送
 */

var BASE = "https://api.xingchiapi.com/api/v1";
var UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

var K_AT = "xingchiapi_at";
var K_RT = "xingchiapi_rt";

var arg = ($argument && typeof $argument === "object") ? $argument : {};
var ARG_AT = arg.AccessToken ? String(arg.AccessToken).trim() : "";
var ARG_RT = arg.RefreshToken ? String(arg.RefreshToken).trim() : "";

function log(m) { console.log("[xingchi] " + m); }

function push(title, sub, body) {
  console.log("[xingchi] 通知: " + title + " | " + sub + " | " + body);
  $notification.post(title, sub, body);
}

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

function isPlaceholder(v) {
  return !v || v.indexOf("在这里") === 0 || v.indexOf("<") === 0;
}

function parse(data) {
  try { return JSON.parse(data || "{}"); } catch (e) { return {}; }
}

function num(v, d) {
  var n = Number(v);
  return isNaN(n) ? (d === undefined ? 0 : d) : n;
}

function fmt(v) {
  var n = num(v, 0);
  return String(Math.round(n * 100) / 100);
}

/* ---------- 主流程 ---------- */

function main() {
  var at = store(K_AT);
  if (!at && !isPlaceholder(ARG_AT)) { at = ARG_AT; }
  var rt = store(K_RT);
  if (!rt && !isPlaceholder(ARG_RT)) { rt = ARG_RT; }

  if (!at && !rt) {
    push("星驰API 签到未配置", "没有可用令牌",
      "请在 Loon 里打开一次 api.xingchiapi.com（自动抓取令牌），或在插件参数里粘贴 Access/Refresh Token");
    return finish();
  }
  log("令牌来源 at=" + (at ? "有(" + at.length + ")" : "无") + " rt=" + (rt ? "有(" + rt.length + ")" : "无"));
  getStatus(at, true);
}

function finish() {
  try { $done({}); } catch (e) {}
}

function getStatus(at, allowRefresh) {
  if (!at) { return doRefresh(allowRefresh ? "no-at" : "again"); }
  $httpClient.get({
    url: BASE + "/user/checkin",
    headers: { "Authorization": "Bearer " + at, "Accept": "application/json", "User-Agent": UA },
    timeout: 12000
  }, function (err, resp, data) {
    var code = resp ? resp.status : -1;
    if (!err && code === 200) {
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
  var rt = store(K_RT);
  if (!rt && !isPlaceholder(ARG_RT)) { rt = ARG_RT; }
  if (!rt) {
    push("星驰API 令牌已过期", "需要重新登录站点",
      "没有 refresh token 可续期。打开一次 api.xingchiapi.com 并登录，令牌会自动抓取；或在插件参数里填 RefreshToken");
    return finish();
  }
  log("刷新令牌（原因: " + reason + "）");
  $httpClient.post({
    url: BASE + "/auth/refresh",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA },
    body: JSON.stringify({ refresh_token: rt }),
    timeout: 12000
  }, function (err, resp, data) {
    var code = resp ? resp.status : -1;
    var j = parse(data);
    var d = j.data || j;
    if (err || code !== 200 || !d.access_token) {
      var msg = err ? String(err) : ("HTTP " + code + " " + (j.message || j.code || ""));
      log("刷新失败: " + msg);
      push("星驰API 令牌刷新失败", String(code), "请重新登录 api.xingchiapi.com 以更新令牌（" + msg.slice(0, 80) + "）");
      return finish();
    }
    save(K_AT, d.access_token);
    save(K_RT, d.refresh_token);   // 轮换：旧 rt 已作废，必须回写
    log("刷新成功，新令牌已存入 store（expires_in=" + (d.expires_in || "-") + "s）");
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
  var at = store(K_AT);
  if (!at && !isPlaceholder(ARG_AT)) { at = ARG_AT; }
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
      var body = "今日 +" + fmt(d.amount !== undefined ? d.amount : s.amount) +
        "｜累计 " + num(s.total_count) + " 天 / 共 " + fmt(s.total_amount) +
        "｜余额 " + fmt(d.new_balance);
      push("星驰API 签到成功", "🌟 +" + fmt(d.amount !== undefined ? d.amount : s.amount), body);
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
