/*
 * Altare 每日签到（Loon cron 脚本）· 双账号版
 * 接口：GET  /api/tenants/{team}/rewards        查 canClaim
 *       POST /api/tenants/{team}/rewards/claim  领取
 * 鉴权：Authorization: Bearer <altr token>
 * 行为：逐个账号处理；全部已领 → 静默；有领取成功或失败 → 一条汇总推送
 * 参数顺序（与 .plugin 里 script 的 { } 列表一致）：Team, Token, Team2, Token2
 */

var BASE = "https://console.altare.gg/api";
var POS = ["Team", "Token", "Team2", "Token2"];

/* ---------- 参数解析：兼容对象 / 数组 / JSON 字符串 / 本地存储 ---------- */
var P = null;
try {
  if (typeof $argument === "object" && $argument) P = $argument;
  else if (typeof $argument === "string" && $argument) { try { P = JSON.parse($argument); } catch (e) { P = null; } }
} catch (e) { P = null; }
if (!P) P = {};

function arg(k) {
  if (P && typeof P === "object") {
    if (Object.prototype.toString.call(P) === "[object Array]") {
      var i = POS.indexOf(k);
      if (i >= 0 && P[i] !== undefined && P[i] !== null && String(P[i]) !== "") return String(P[i]).trim();
    } else if (P[k] !== undefined && P[k] !== null && String(P[k]) !== "") {
      return String(P[k]).trim();
    }
  }
  try { return String($persistentStore.read(k) || "").trim(); } catch (e) { return ""; }
}

function log(msg) { console.log("[altare] " + msg); }
function push(title, subtitle, body) {
  console.log("[altare] 通知: " + title + " | " + subtitle + " | " + body);
  $notification.post(title, subtitle, body);
}
function bolts(cents) { return (Number(cents || 0) / 100).toFixed(2); }

function validToken(t) {
  return !!t && t.indexOf("在这里") !== 0 && t.indexOf("粘贴") < 0 && t.length >= 20;
}

/* ---------- 账号表 ---------- */
var accounts = [];
(function buildAccounts() {
  var t1 = arg("Token"), team1 = arg("Team");
  var t2 = arg("Token2"), team2 = arg("Team2") || team1;
  if (validToken(t1)) accounts.push({ name: "账号1", team: team1, token: t1 });
  else if (t1) log("账号1 Token 无效（长度 " + t1.length + "）");
  if (validToken(t2)) accounts.push({ name: "账号2", team: team2, token: t2 });
  else if (t2) log("账号2 Token 无效（长度 " + t2.length + "）");
})();

if (!accounts.length) {
  log("没有可用账号：Token 未填或仍是占位符");
  push("Altare 签到未配置", "缺少 Token", "插件参数里 Token 还是占位符，请在 iSH 执行 altr token 后粘贴（第二个账号填 Token2，留空则不启用）");
  $done({});
} else {
  log("本次处理 " + accounts.length + " 个账号");
  runQueue(accounts, [], function (results) { finish(results); });
}

/* ---------- 串行处理，避免多个 $done 冲突 ---------- */
function runQueue(list, acc, cb) {
  if (!list.length) return cb(acc);
  var a = list[0];
  handleAccount(a, function (r) {
    acc.push(r);
    runQueue(list.slice(1), acc, cb);
  });
}

function handleAccount(a, done) {
  var res = { name: a.name, state: "error", detail: "", claimed: false };
  if (!a.team) {
    res.detail = "团队ID为空";
    log(a.name + " 跳过：" + res.detail);
    return done(res);
  }
  $httpClient.get({
    url: BASE + "/tenants/" + a.team + "/rewards",
    headers: { "Authorization": "Bearer " + a.token }
  }, function (err, resp, data) {
    if (err || !resp || resp.status !== 200) {
      res.detail = err ? String(err) : ("查状态 HTTP " + (resp ? resp.status : "-") + " " + String(data || "").slice(0, 80));
      log(a.name + " " + res.detail);
      return done(res);
    }
    var st = {};
    try { st = JSON.parse(data); } catch (e) { st = {}; }
    var daily = st.daily || {};
    if (!daily.canClaim) {
      res.state = "already";
      res.detail = "今日已领（连签 " + (daily.currentStreak || 0) + " 天）";
      log(a.name + " " + res.detail + "，静默");
      return done(res);
    }
    log(a.name + " 可领：" + bolts(daily.totalRewardCents) + " bolts（基础 " + bolts(daily.baseRewardCents) + " + 连签 " + bolts(daily.streakBonusCents) + "）");
    $httpClient.post({
      url: BASE + "/tenants/" + a.team + "/rewards/claim",
      headers: { "Authorization": "Bearer " + a.token, "Content-Type": "application/json" },
      body: "{}"
    }, function (e2, r2, d2) {
      if (e2 || !r2 || r2.status !== 200) {
        res.detail = e2 ? String(e2) : ("领取 HTTP " + (r2 ? r2.status : "-") + " " + String(d2 || "").slice(0, 100));
        log(a.name + " " + res.detail);
        return done(res);
      }
      var j = {};
      try { j = JSON.parse(d2); } catch (e3) { j = {}; }
      res.state = "claimed";
      res.claimed = true;
      res.detail = "+" + bolts(j.totalRewardCents || daily.totalRewardCents) + " bolts｜连签 " +
        (j.newStreak || daily.nextStreak || "-") + " 天｜余额 " + bolts(j.balanceCents);
      log(a.name + " 领取成功 " + res.detail);
      done(res);
    });
  });
}

function finish(results) {
  var claimed = results.filter(function (r) { return r.state === "claimed"; });
  var errors = results.filter(function (r) { return r.state === "error"; });
  if (!claimed.length && !errors.length) {
    log("全部账号今日已领，静默退出");
    return $done({});
  }
  var lines = [];
  results.forEach(function (r) {
    if (r.state === "claimed") lines.push(r.name + " ✅ " + r.detail);
    else if (r.state === "error") lines.push(r.name + " ❌ " + r.detail);
    else lines.push(r.name + " · " + r.detail);
  });
  var title = errors.length ? (claimed.length ? "Altare 签到（部分失败）" : "Altare 签到失败") : "Altare 签到成功";
  var gotSum = claimed.reduce(function (s, r) {
    var m = /\+([\d.]+) bolts/.exec(r.detail);
    return s + (m ? Number(m[1]) : 0);
  }, 0);
  var sub = claimed.length ? (claimed.length + " 个账号 +" + gotSum.toFixed(2) + " bolts") : "无可领取";
  push(title, sub, lines.join("\n"));
  $done({});
}
