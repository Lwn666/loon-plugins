/*
 * altare-signin 双账号版 mock 测试（node mock-test.js）
 * 模拟 Loon：$argument / $httpClient / $notification / $done / $persistentStore
 * GET 计划可传数组，按调用序号依次返回
 */
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "altare-signin.js"), "utf8");
const TESTS = [];
function test(name, plan, argument, expect) { TESTS.push({ name, plan, argument, expect }); }

function runOne(t) {
  return new Promise((resolve) => {
    const { name, plan, argument, expect } = t;
    const calls = [];
    const notes = [];
    let getIdx = 0;

    const ctx = {
      console: { log: () => {} },
      $argument: argument,
      $persistentStore: { read: () => null, write: () => true },
      $notification: { post: (ti, s, b) => notes.push({ t: ti, s, b }) },
      $done: () => calls.push({ done: true }),
      $httpClient: {
        get: (req, cb) => {
          calls.push({ method: "GET", url: req.url, auth: req.headers.Authorization });
          const p = Array.isArray(plan.GET) ? plan.GET[Math.min(getIdx++, plan.GET.length - 1)] : plan.GET;
          setTimeout(() => {
            if (p.error) return cb(p.error, null, "");
            cb(null, { status: p.status }, JSON.stringify(p.body || {}));
          }, 0);
        },
        post: (req, cb) => {
          calls.push({ method: "POST", url: req.url, auth: req.headers.Authorization });
          const p = plan.POST || { status: 500, body: {} };
          setTimeout(() => {
            if (p.error) return cb(p.error, null, "");
            cb(null, { status: p.status }, JSON.stringify(p.body || {}));
          }, 0);
        },
      },
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: "altare-signin.js" });

    setTimeout(() => {
      const got = {
        get: calls.filter((c) => c.method === "GET").length,
        post: calls.filter((c) => c.method === "POST").length,
        notes: notes.length,
        done: calls.filter((c) => c.done).length,
        getUrls: calls.filter((c) => c.method === "GET").map((c) => c.url),
        getAuth: calls.filter((c) => c.method === "GET").map((c) => (c.auth || "").slice(-4)),
        noteText: notes.map((n) => n.t + " | " + n.s + " | " + n.b).join("\n---\n"),
      };
      const errs = [];
      const chk = (cond, msg) => { if (!cond) errs.push(msg); };
      if (expect.get !== undefined) chk(got.get === expect.get, `GET ${got.get} != ${expect.get}`);
      if (expect.post !== undefined) chk(got.post === expect.post, `POST ${got.post} != ${expect.post}`);
      if (expect.notes !== undefined) chk(got.notes === expect.notes, `推送 ${got.notes} 条 != ${expect.notes}`);
      if (expect.done !== undefined) chk(got.done === expect.done, `$done ${got.done} != ${expect.done}`);
      if (expect.auth) expect.auth.forEach((h, i) => chk(got.getAuth[i] === h, `第${i + 1}次 GET 令牌尾号 ${got.getAuth[i]} != ${h}`));
      if (expect.noteHas) chk(got.noteText.includes(expect.noteHas), `推送缺少「${expect.noteHas}」`);
      if (expect.noteLacks) chk(!got.noteText.includes(expect.noteLacks), `推送不应含「${expect.noteLacks}」`);
      if (expect.urlHas) expect.urlHas.forEach((s) => chk(got.noteText.includes(s) || got.getUrls.some((u) => u.includes(s)), `URL 缺少 ${s}`));
      if (errs.length) {
        console.log(`✗ ${name}\n   ` + errs.join("\n   ") + `\n   推送: ${got.noteText.slice(0, 300)}`);
        return resolve(false);
      }
      console.log(`✓ ${name}`);
      resolve(true);
    }, 80);
  });
}

const CLAIMABLE = { daily: { canClaim: true, baseRewardCents: 1333, streakBonusCents: 603, totalRewardCents: 1936, currentStreak: 9, nextStreak: 10 } };
const DONE_TODAY = { daily: { canClaim: false, currentStreak: 9, lastClaimISO: "2026-11-27T00:15:02.089Z" } };
const CLAIM_OK = { totalRewardCents: 1936, newStreak: 10, balanceCents: 23184, streakBonusCents: 603 };

const T1 = "t0ken-account-one-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
const T2 = "t0ken-account-two-bbbbbbbbbbbbbbbbbbbbbbbbbbbb2";

test("双账号都能领 → 2 POST + 一条汇总", { GET: { status: 200, body: CLAIMABLE }, POST: { status: 200, body: CLAIM_OK } },
  { Team: "t1", Token: T1, Team2: "t2", Token2: T2 },
  { get: 2, post: 2, notes: 1, done: 1, auth: ["aaa1", "bbb2"], noteHas: "2 个账号 +38.72 bolts" });

test("账号1 已领 + 账号2 领取", { GET: [{ status: 200, body: DONE_TODAY }, { status: 200, body: CLAIMABLE }], POST: { status: 200, body: CLAIM_OK } },
  { Team: "t1", Token: T1, Team2: "t2", Token2: T2 },
  { get: 2, post: 1, notes: 1, done: 1, noteHas: "今日已领（连签 9 天）" });

test("两个都已领 → 静默不推送", { GET: { status: 200, body: DONE_TODAY } },
  { Team: "t1", Token: T1, Team2: "t2", Token2: T2 },
  { get: 2, post: 0, notes: 0, done: 1 });

test("只填账号1（向后兼容）", { GET: { status: 200, body: CLAIMABLE }, POST: { status: 200, body: CLAIM_OK } },
  { Team: "t1", Token: T1, Team2: "", Token2: "" },
  { get: 1, post: 1, notes: 1, done: 1, noteLacks: "账号2" });

test("账号2 令牌失效 401 → 部分失败", { GET: [{ status: 200, body: CLAIMABLE }, { status: 401, body: { error: "Unauthorized" } }], POST: { status: 200, body: CLAIM_OK } },
  { Team: "t1", Token: T1, Team2: "t2", Token2: T2 },
  { get: 2, post: 1, notes: 1, done: 1, noteHas: "部分失败", noteLacks: "签到成功" });

test("账号1 领取 500 + 账号2 成功", { GET: { status: 200, body: CLAIMABLE }, POST: { status: 500, body: { error: "boom" } } },
  { Team: "t1", Token: T1, Team2: "t2", Token2: T2 },
  { get: 2, post: 2, notes: 1, done: 1, noteHas: "领取 HTTP 500" });

test("Token 仍是占位符 → 提示未配置", { GET: { status: 200, body: CLAIMABLE } },
  { Team: "t1", Token: "在这里粘贴altr-token", Team2: "", Token2: "" },
  { get: 0, notes: 1, done: 1, noteHas: "未配置" });

test("数组参数 [Team,Token,Team2,Token2]", { GET: { status: 200, body: CLAIMABLE }, POST: { status: 200, body: CLAIM_OK } },
  ["t1", T1, "t2", T2],
  { get: 2, post: 2, notes: 1, done: 1, auth: ["aaa1", "bbb2"] });

test("Team2 留空 → 沿用账号1 团队", { GET: { status: 200, body: CLAIMABLE }, POST: { status: 200, body: CLAIM_OK } },
  { Team: "t1", Token: T1, Team2: "", Token2: T2 },
  { get: 2, post: 2, notes: 1, done: 1 });

(async () => {
  let ok = 0;
  for (const t of TESTS) if (await runOne(t)) ok++;
  console.log(`\n${ok}/${TESTS.length} 通过`);
  process.exitCode = ok === TESTS.length ? 0 : 1;
})();
