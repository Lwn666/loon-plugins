/*
 * mock-test.js — 用桩数据覆盖 readify-signin.js 各分支（不发真实请求、不改线上状态）
 * 用法：node mock-test.js
 */
const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync(__dirname + "/readify-signin.js", "utf8");

function run(name, plan, expect, seed, argument) {
  const posts = [];
  let notice = null;
  const store = Object.assign({}, seed || {}, { readify_token: "a." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString("base64url") + ".c", readify_user_id: "u1", readify_device_id: "d1" });
  const queue = plan.slice();

  function pick(method, url) {
    const key = method + " " + url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].key === key) return queue.splice(i, 1)[0];
    }
    throw new Error("未预期的请求: " + key);
  }
  const client = {
    get: (o, cb) => {
      const r = pick("GET", o.url); posts.push("GET " + o.url.replace(/^https?:\/\/[^/]+/, ""));
      if (r.net) return cb(new Error(r.net), null, null);
      cb(null, { status: r.status || 200 }, JSON.stringify(r.body));
    },
    post: (o, cb) => {
      const r = pick("POST", o.url); posts.push("POST " + o.url.replace(/^https?:\/\/[^/]+/, ""));
      if (r.net) return cb(new Error(r.net), null, null);
      cb(null, { status: r.status || 200 }, JSON.stringify(r.body));
    }
  };

  const sandbox = {
    console: { log: () => {} },
    setTimeout: (fn) => fn(),
    Date, JSON, Math, String, Number, Object, Array, RegExp, Error, encodeURIComponent, decodeURIComponent,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    escape: (s) => encodeURIComponent(s),
    $persistentStore: { read: (k) => store[k] || "", write: (v, k) => { store[k] = v; return true; } },
    $notification: { post: (t, s, m) => { notice = { t, s, m }; } },
    $httpClient: client,
    $argument: argument || JSON.stringify({ CAMPAIGN_ID: "reading-streak-7d-202607", DEBUG: "false" }),
    $done: () => {}
  };
  sandbox.global = sandbox;

  let ok = true, err = "";
  try {
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { timeout: 5000 });
    if (!notice) throw new Error("没有产生通知");
    if (expect.sub && !notice.s.includes(expect.sub)) throw new Error("副标题不符，实际：" + notice.s);
    for (const frag of (expect.msg || [])) {
      if (!notice.m.includes(frag)) throw new Error("正文缺少「" + frag + "」，实际：" + notice.m.replace(/\n/g, " | "));
    }
    if (expect.query && !posts.some((p) => p.indexOf(expect.query) >= 0)) throw new Error("请求里没有 " + expect.query + "，实际 " + posts.join(","));
    if (expect.posts !== undefined && posts.filter((p) => p.startsWith("POST")).length !== expect.posts) {
      throw new Error("POST 次数不符，实际 " + posts.filter((p) => p.startsWith("POST")).join(","));
    }
  } catch (e) {
    ok = false; err = e.message;
  }
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok ? "" : "  → " + err));
  if (ok) console.log("       [" + notice.s + "] " + notice.m.replace(/\n/g, " | "));
  return ok;
}

const S = (data) => ({ key: "GET /api/campaigns/streaks/status", body: { code: 0, message: "Success", data: data } });
const CHK = (data) => ({ key: "POST /api/campaigns/streaks", body: { code: 0, message: "Success", data: data } });
const CLM = (data) => ({ key: "POST /api/campaigns/streaks/reward-claims", body: { code: 0, message: "Success", data: data } });

const base = { campaignId: "reading-streak-7d-202607", activityStatus: "ACTIVE", timezone: "Asia/Hong_Kong" };

let pass = 0, total = 0;
function t(...a) { total++; if (run(...a)) pass++; }

// 1. 第 6 天签到 → 第 7 天可领 → 领奖成功
t("签到+领奖全链路", [
  S(Object.assign({}, base, { roundStatus: "IN_PROGRESS", currentDay: 6, streakedToday: false, canCheckIn: true, canClaim: false })),
  CHK({ checkInResult: "CHECKED_IN", currentDay: 7, streakedToday: true }),
  S(Object.assign({}, base, { roundStatus: "CLAIMABLE", currentDay: 7, streakedToday: true, canCheckIn: false, canClaim: true })),
  CLM({ claimResult: "CLAIMED", rewardType: "VOICE_SEAT", rewardCount: 2, ultraHdDays: 7, claimedAt: 1795788398181, nextAvailableAt: 1795795200000 })
], { sub: "签到 + 领奖成功", msg: ["第 7 天", "语音席位 ×2 + 超清 7 天", "下次可领：11-28 00:00"], posts: 2 });

// 2. 今日已签、奖励待领（本次抓包场景）
t("已签到仅领奖", [
  S(Object.assign({}, base, { roundStatus: "CLAIMABLE", currentDay: 7, streakedToday: true, canCheckIn: false, canClaim: true })),
  CLM({ claimResult: "CLAIMED", rewardType: "VOICE_SEAT", rewardCount: 2, ultraHdDays: 7, claimedAt: 1795788398181, nextAvailableAt: 1795795200000 })
], { sub: "奖励领取成功", msg: ["语音席位 ×2", "领取时间：11-27 22:06"], posts: 1 });

// 3. 已签已领（今日无需操作）
t("已签已领不重复请求", [
  S(Object.assign({}, base, { roundStatus: "CLAIMED_WAITING", currentDay: 7, streakedToday: true, canCheckIn: false, canClaim: false, claimedAt: 1795788398181, rewardCount: 2, ultraHdDays: 7, nextAvailableAt: 1795795200000 }))
], { sub: "奖励已领", msg: ["第 7 天", "此前已领取", "超清 7 天"], posts: 0 });

// 4. 领奖返回 ALREADY_CLAIMED → 只读回查确认
t("领奖已领过（回查确认）", [
  S(Object.assign({}, base, { roundStatus: "CLAIMABLE", currentDay: 7, streakedToday: true, canCheckIn: false, canClaim: true })),
  { key: "POST /api/campaigns/streaks/reward-claims", body: { code: 400001, message: "REWARD_ALREADY_CLAIMED" } },
  S(Object.assign({}, base, { roundStatus: "CLAIMED_WAITING", currentDay: 7, streakedToday: true, canCheckIn: false, canClaim: false, claimedAt: 1795788398181, rewardCount: 2, ultraHdDays: 7, nextAvailableAt: 1795795200000 }))
], { sub: "奖励领取成功", msg: ["回查确认", "奖励 ×2"], posts: 1 });

// 5. 领奖网络错误 → 回查显示已到账
t("领奖网络错误但已到账", [
  S(Object.assign({}, base, { roundStatus: "CLAIMABLE", currentDay: 7, streakedToday: true, canCheckIn: false, canClaim: true })),
  { key: "POST /api/campaigns/streaks/reward-claims", net: "ECONNRESET" },
  S(Object.assign({}, base, { roundStatus: "CLAIMED_WAITING", canClaim: false, claimedAt: 1795788398181, rewardCount: 2, ultraHdDays: 7, nextAvailableAt: 1795795200000 }))
], { sub: "奖励领取成功", msg: ["回查确认", "超清 7 天"], posts: 1 });

// 6. 领奖网络错误且未到账 → 未知，不重试
t("领奖结果未知不重试", [
  S(Object.assign({}, base, { roundStatus: "CLAIMABLE", currentDay: 7, streakedToday: true, canCheckIn: false, canClaim: true })),
  { key: "POST /api/campaigns/streaks/reward-claims", net: "ECONNRESET" },
  S(Object.assign({}, base, { roundStatus: "CLAIMABLE", canClaim: true }))
], { sub: "领奖结果未知", msg: ["未重复提交"], posts: 1 });

// 7. token 失效（HTTP 200 + code 200000）
t("凭证失效", [
  { key: "GET /api/campaigns/streaks/status", body: { code: 200000, message: "Invalid user token" } }
], { sub: "凭证失效", msg: ["Invalid user token", "打开 Readify App"], posts: 0 });

// 8. 活动未开始
t("活动未进行", [
  S(Object.assign({}, base, { activityStatus: "NOT_STARTED", roundStatus: "", currentDay: 0, streakedToday: false, canCheckIn: false, canClaim: false }))
], { msg: ["活动状态：NOT_STARTED"], posts: 0 });

// 9. 签到失败但今天有奖励可领
t("签到失败仍尝试领奖", [
  S(Object.assign({}, base, { roundStatus: "CLAIMABLE", currentDay: 7, streakedToday: false, canCheckIn: true, canClaim: true })),
  { key: "POST /api/campaigns/streaks", body: { code: 500100, message: "Check-in failed" } },
  CLM({ claimResult: "CLAIMED", rewardType: "VOICE_SEAT", rewardCount: 2, ultraHdDays: 7, claimedAt: 1795788398181, nextAvailableAt: 1795795200000 })
], { sub: "❌ 签到失败", msg: ["Check-in failed", "语音席位 ×2"], posts: 2 });

// 10. 状态无 rewardType，用本地历史领奖记录补全文案
t("历史领奖记录补全奖励名", [
  S(Object.assign({}, base, { roundStatus: "CLAIMED_WAITING", currentDay: 7, streakedToday: true, canCheckIn: false, canClaim: false, claimedAt: 1795788398181, rewardCount: 2, ultraHdDays: 7, nextAvailableAt: 1795795200000 }))
], { sub: "奖励已领", msg: ["语音席位 ×2"], posts: 0 }, {
  readify_last_claim: JSON.stringify({ campaignId: "reading-streak-7d-202607", rewardType: "VOICE_SEAT", rewardCount: 2, ultraHdDays: 7 })
});

// 11. Loon 以数组传参时按位置映射（CAMPAIGN_ID, DEBUG, CLAIM_ENABLE）
t("数组参数按位置映射", [
  S(Object.assign({}, base, { campaignId: "custom-camp-999", roundStatus: "IN_PROGRESS", currentDay: 2, streakedToday: false, canCheckIn: false, canClaim: false }))
], { sub: "今日已签到", query: "campaignId=custom-camp-999", posts: 0 }, null, JSON.stringify(["custom-camp-999", "false", "true"]));

console.log("\n" + pass + "/" + total + " 通过");
process.exit(pass === total ? 0 : 1);
