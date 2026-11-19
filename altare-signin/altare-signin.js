/*
 * Altare 每日签到（Loon cron 脚本）
 * 接口：GET  /api/tenants/{team}/rewards            查 canClaim
 *       POST /api/tenants/{team}/rewards/claim      领取
 * 鉴权：Authorization: Bearer <altr token>
 * 行为：已领过 → 静默（不推送）；领取成功/失败 → 推送明细
 */

var BASE = "https://console.altare.gg/api";
var TEAM = ($argument && $argument.Team) ? String($argument.Team).trim() : "";
var TOKEN = ($argument && $argument.Token) ? String($argument.Token).trim() : "";

function push(title, subtitle, body) {
  console.log("[altare] 通知: " + title + " | " + subtitle + " | " + body);
  $notification.post(title, subtitle, body);
}

function log(msg) { console.log("[altare] " + msg); }

function bolts(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

if (!TEAM || !TOKEN || TOKEN.indexOf("在这里") === 0 || TOKEN.length < 20) {
  log("参数不完整 team=" + (TEAM ? "ok" : "空") + " token=" + (TOKEN && TOKEN.length >= 20 ? "ok" : "未填或过短(" + TOKEN.length + ")"));
  push("Altare 签到未配置", "缺少 Token", "插件参数里 Token 还占位符，请在 iSH 执行 altr token 后粘贴");
  $done({});
} else {
  $httpClient.get({
    url: BASE + "/tenants/" + TEAM + "/rewards",
    headers: { "Authorization": "Bearer " + TOKEN }
  }, function (err, resp, data) {
    if (err || !resp || resp.status !== 200) {
      var msg = err ? String(err) : ("HTTP " + (resp ? resp.status : "-"));
      if (!resp || resp.status !== 200) {
        push("Altare 签到状态查询失败", msg, String(data || "").slice(0, 160));
      }
      return $done({});
    }

    var st = {};
    try { st = JSON.parse(data); } catch (e) { st = {}; }
    var daily = st.daily || {};

    if (!daily.canClaim) {
      log("今天已领过（last=" + (daily.lastClaimISO || "-") + " 连签=" + (daily.currentStreak || 0) + "），静默退出");
      return $done({});
    }
    log("可以领取：基础 " + bolts(daily.baseRewardCents) + " bolts，连签加成 " + bolts(daily.streakBonusCents) + "，本次合计 " + bolts(daily.totalRewardCents));

    $httpClient.post({
      url: BASE + "/tenants/" + TEAM + "/rewards/claim",
      headers: {
        "Authorization": "Bearer " + TOKEN,
        "Content-Type": "application/json"
      },
      body: "{}"
    }, function (e2, r2, d2) {
      if (e2 || !r2 || r2.status !== 200) {
        var m2 = e2 ? String(e2) : ("HTTP " + (r2 ? r2.status : "-"));
        push("Altare 签到失败", m2, String(d2 || "").slice(0, 160));
        return $done({});
      }
      var j = {};
      try { j = JSON.parse(d2); } catch (e3) { j = {}; }
      log("领取成功 balance=" + bolts(j.balanceCents) + " streak=" + (j.newStreak || "-"));
      var got = bolts(j.totalRewardCents);
      var bonus = Number(j.streakBonusCents || 0) > 0 ? ("（连签加成 +" + bolts(j.streakBonusCents) + "）") : "";
      push(
        "Altare 签到成功",
        "+" + got + " bolts" + bonus,
        "连签 " + (j.newStreak || daily.nextStreak || "-") + " 天｜余额 " + bolts(j.balanceCents) + " bolts"
      );
      $done({});
    });
  });
}
