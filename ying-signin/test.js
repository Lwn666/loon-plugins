"use strict";
// Tests execute the production file, not a copied implementation.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "ying-signin.js"), "utf8");
const NOW = Date.parse("2026-11-26T00:00:00Z"), DAY = 86400000;
const key = (who, part) => "ying.v1." + encodeURIComponent(who) + "." + part;
const tests = [];
const test = (name, body) => tests.push({ name, body });
function dateAt(days) { return new Date(NOW + days * DAY).toISOString().slice(0, 10).replace(/-/g, "/"); }
function server(changes = {}) {
  return Object.assign({ coins: 179, remaining: 29, date: dateAt(29), can: false,
    last: "2026-11-25T00:00:00.000Z", question: "请计算：（１２＋3）×2÷（5－2） = ?",
    config: { membershipEnabled: true, membershipCostPerDay: 3, membershipMinDays: 10, membershipMaxDays: 30 },
    logins: 0, redeems: 0, checkins: 0 }, changes);
}
async function run({ state = server(), disk = new Map(), username = "mock-account-A", password = "mock-only-password",
  auto = true, hook, writeFail, readFail, onWrite, now = NOW } = {}) {
  const calls = [], notes = [], logs = [], hits = new Map(), harnessErrors = [];
  let done = 0;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  function dispatch(method, options, cb) {
    const url = new URL(options.url), p = url.pathname;
    assert.equal(url.origin, "https://ying.wedg.top");
    assert.equal(options.timeout, 15000);
    assert.equal(options.insecure, false);
    assert.equal(options["auto-cookie"], false);
    assert.equal(options["auto-redirect"], false);
    assert.equal(options.headers.Origin, "https://ying.wedg.top");
    assert.equal(options.headers.Referer, "https://ying.wedg.top/account");
    if (p === "/api/auth/login") assert.equal(options.headers.Cookie, undefined);
    else assert.match(options.headers.Cookie || "", /^stream_session=[^;]+$/);
    const call = { method, path: p, options, data: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    const id = method + " " + p, nth = (hits.get(id) || 0) + 1; hits.set(id, nth);
    let reply = hook && hook({ ...call, nth, state, disk });
    if (!reply) {
      let body, headers = {}, status = 200;
      if (id === "POST /api/auth/login") {
        state.logins++;
        assert.deepEqual(call.data, { identifier: username.trim(), password });
        body = { user: { id: username, email: "mock@example.invalid", role: "user" } };
        headers = { "sEt-CoOkIe": ["other=mock; Path=/", "stream_session=mock-session-" + username + "; HttpOnly; Path=/"] };
      } else if (id === "GET /api/me/checkin") {
        body = { enabled: true, webEnabled: true, requireActiveMembership: true, isActiveMember: true,
          canCheckin: state.can, locked: false, lockedUntil: null, coins: state.coins,
          nextCheckinAt: "2026-11-27T00:00:00.000Z", lastCheckinAt: state.last,
          downloadBonusCheckins: 5, downloadBonusEnabled: true,
          config: { mode: "daily", dailyResetHour: 8, rewardType: "coins", rewardMin: 1, rewardMax: 10 } };
        if (state.checkinFields) Object.assign(body, state.checkinFields);
      } else if (id === "GET /api/me/checkin/challenge") body = { challengeId: "mock-challenge", question: state.question };
      else if (id === "POST /api/me/checkin") {
        state.checkins++; state.can = false; state.last = new Date(now).toISOString(); state.coins += 5;
        body = { message: "mock", rewardType: "coins", reward: 5, coins: state.coins };
      } else if (id === "GET /api/me/coins/redeem") body = { coins: state.coins, config: state.config, available: true };
      else if (id === "GET /account") body = state.html !== undefined ? state.html : "<article><h2>当前订阅</h2><div class='sub'><b>会员服务已开通</b><span>到期：" + state.date + "</span></div></article>";
      else if (id === "POST /api/me/coins/redeem") {
        assert.equal(call.data.type, "membership"); assert.equal(Object.keys(call.data).length, 2);
        assert.ok(call.data.days >= state.config.membershipMinDays && call.data.days <= 30);
        state.redeems++; state.coins -= call.data.days * state.config.membershipCostPerDay;
        if (!state.keepDate) state.date = new Date(Date.parse(state.date + " 00:00:00 GMT") + call.data.days * DAY).toISOString().slice(0, 10).replace(/-/g, "/");
        body = { message: "unknown actual success format" };
      } else throw new Error("Unexpected route " + id);
      reply = { status, headers, body };
    }
    if (reply.error) return cb(reply.error, undefined, undefined);
    const response = { headers: reply.headers || {} };
    response[reply.statusCode !== undefined ? "statusCode" : "status"] = reply.statusCode !== undefined ? reply.statusCode : (reply.status || 200);
    cb(null, response, typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
  }
  const context = vm.createContext({ Date: Clock,
    $argument: { USERNAME: username, PASSWORD: password, AUTO_RENEW: auto },
    $persistentStore: {
      read(k) { if (readFail && readFail(k)) throw new Error("mock read failure"); return disk.has(k) ? disk.get(k) : null; },
      write(value, k) { if (writeFail && writeFail(k, value)) return false; disk.set(k, value); if (onWrite) onWrite(k, value, disk); return true; }
    },
    $httpClient: Object.fromEntries(["GET", "POST"].map(method => [method.toLowerCase(), (o, cb) => {
      try { dispatch(method, o, cb); } catch (e) { harnessErrors.push(e); cb("mock harness failure"); }
    }])),
    $notification: { post: (a, b, c) => notes.push(c) }, console: { log: s => logs.push(s) },
    $done: () => { done++; }
  });
  assert.equal(vm.runInContext("[typeof require,typeof Buffer,typeof atob,typeof document,typeof fetch].join(',')", context), "undefined,undefined,undefined,undefined,undefined");
  await vm.runInContext(source, context, { filename: "ying-signin.js", timeout: 1000 });
  if (harnessErrors.length) throw harnessErrors[0];
  assert.equal(done, 1); assert.equal(notes.length, 1);
  for (const secret of [password, "mock-session-", "mock@example.invalid", "RAW_SECRET_SENTINEL"]) {
    if (secret) assert.ok(!notes.concat(logs).join("\n").includes(secret), "sensitive output: " + secret);
  }
  return { state, disk, calls, text: notes[0], logs };
}
const posts = r => r.calls.filter(c => c.method === "POST" && c.path === "/api/me/coins/redeem");
const challengeCalls = r => r.calls.filter(c => c.path === "/api/me/checkin/challenge");
const pending = r => JSON.parse(r.disk.get(key("mock-account-A", "pending")) || "null");
test("已签到仍独立续期；多 Cookie 数组和混合大小写", async () => {
  const r = await run(); assert.equal(posts(r).length, 1); assert.equal(posts(r)[0].data.days, 30);
  assert.equal(challengeCalls(r).length, 0); assert.match(r.text, /续期成功/); assert.equal(pending(r), null);
});
for (const [days, count] of [[30, 0], [29, 1], [31, 0]]) test("剩余 " + days + " 天兑换 POST=" + count, async () => {
  const r = await run({ state: server({ date: dateAt(days) }) }); assert.equal(posts(r).length, count);
});
test("北京时间跨日；不是按剩余毫秒取整", async () => {
  const r = await run({ state: server({ date: dateAt(30) }), now: Date.parse("2026-11-26T16:01:00Z") });
  assert.equal(posts(r).length, 1); assert.match(r.text, /剩余 59 天/);
});
for (const html of ["<article><h2>当前订阅</h2>日期未知</article>",
  "<script>const expiry='2026/12/01'</script>",
  "<article><h2>当前订阅</h2><script>let x='到期：2026/12/01'</script></article>",
  "<article><h2>当前订阅</h2>到期：2026/02/30</article>",
  "<article><h2>当前订阅</h2>到期：2026/12/01 到期：2026/12/02</article>"]) {
  test("坏 HTML/歧义/非法日期不花积分 " + tests.length, async () => {
    const r = await run({ state: server({ html }) }); assert.equal(posts(r).length, 0); assert.match(r.text, /未知|无效|歧义|缺失/);
  });
}
test("余额不足与零积分均不 POST", async () => {
  for (const coins of [0, 29]) { const r = await run({ state: server({ coins }) }); assert.equal(posts(r).length, 0); assert.match(r.text, /积分不足/); }
});
test("自动续期关闭，保留到期与余额只读查询", async () => {
  const r = await run({ auto: false }); assert.equal(posts(r).length, 0); assert.match(r.text, /自动续期关闭/); assert.match(r.text, /2026\/12\/25/);
});
test("安全算术挑战成功，数字 answer=10；回读确认", async () => {
  const r = await run({ state: server({ can: true }), auto: false });
  const call = r.calls.find(c => c.method === "POST" && c.path === "/api/me/checkin");
  assert.deepEqual(call.data, { challengeId: "mock-challenge", answer: 10 }); assert.match(r.text, /签到成功/);
});
for (const question of ["1/2", "2/0", "1+process.exit()", "Math.max(1,2)", "2**3", "(1+2", "9007199254740992+1", "(1/2)*2", "请计算：你好", "2(3+4)"]) {
  test("非法题不 POST；续期仍执行：" + question, async () => {
    const r = await run({ state: server({ can: true, question }) });
    assert.equal(r.state.checkins, 0); assert.equal(posts(r).length, 1); assert.match(r.text, /签到失败/);
  });
}
test("整数负数和优先级支持", async () => {
  const r = await run({ state: server({ can: true, question: "-3 + 8 / 2 * (5 - 2) = ?" }), auto: false });
  assert.equal(r.calls.find(c => c.path === "/api/me/checkin" && c.method === "POST").data.answer, 9);
});
for (const fields of [{ enabled: false }, { webEnabled: false }, { locked: true },
  { lockedUntil: "2027-01-01T00:00:00Z" }, { isActiveMember: false }]) test("未开放/锁定/无有效会员不取挑战 " + JSON.stringify(fields), async () => {
  const r = await run({ state: server({ can: true, checkinFields: fields }) }); assert.equal(challengeCalls(r).length, 0); assert.equal(posts(r).length, 1);
});
test("签到状态失败仍评估续期", async () => {
  const r = await run({ hook: c => c.path === "/api/me/checkin" ? { status: 500, body: "RAW_SECRET_SENTINEL" } : undefined });
  assert.equal(posts(r).length, 1); assert.match(r.text, /签到失败/);
});
test("签到200但回读未变不能报成功", async () => {
  const r = await run({ state: server({ can: true }), auto: false,
    hook: c => c.path === "/api/me/checkin" && c.method === "POST" ? { status: 200, body: { message: "ok" } } : undefined });
  assert.doesNotMatch(r.text, /签到成功/); assert.match(r.text, /签到未确认/);
});
test("签到 POST 网络失败不重放，跨运行同日也不提交", async () => {
  const state = server({ can: true }), disk = new Map();
  const hook = c => c.path === "/api/me/checkin" && c.method === "POST" ? { error: "RAW_SECRET_SENTINEL" } : undefined;
  const a = await run({ state, disk, auto: false, hook }), b = await run({ state, disk, auto: false, hook });
  assert.equal(a.calls.filter(c => c.path === "/api/me/checkin" && c.method === "POST").length, 1);
  assert.equal(challengeCalls(b).length, 0); assert.doesNotMatch(a.text, /签到成功/);
});
test("401 缓存失效只重登一次；支持 statusCode", async () => {
  const disk = new Map([[key("mock-account-A", "cookie"), JSON.stringify("stream_session=mock-stale")]]);
  const r = await run({ disk, auto: false, hook: c => c.path === "/api/me/checkin" && c.nth === 1 ? { statusCode: 401, body: {} } : undefined });
  assert.equal(r.state.logins, 1); assert.equal(r.calls.filter(c => c.path === "/api/me/checkin").length, 2);
});
test("持续401/403最多一次重登，不陷入循环", async () => {
  const r = await run({ hook: c => c.path === "/api/auth/login" ? undefined : { status: c.nth === 1 ? 401 : 403, body: {} } });
  assert.equal(r.state.logins, 2); assert.equal(posts(r).length, 0);
});
test("兑换明确401允许一次认证后重放，非网络重试", async () => {
  const r = await run({ hook: c => c.path === "/api/me/coins/redeem" && c.method === "POST" && c.nth === 1 ? { status: 401, body: {} } : undefined });
  assert.equal(posts(r).length, 2); assert.equal(r.state.redeems, 1); assert.equal(r.state.logins, 2); assert.match(r.text, /续期成功/);
});
test("登录200缺 Cookie 必须失败，不请求受保护接口", async () => {
  const r = await run({ hook: c => c.path === "/api/auth/login" ? { status: 200, body: { user: { id: "mock" } } } : undefined });
  assert.equal(r.calls.length, 1); assert.match(r.text, /登录未取得有效会话/);
});
test("无缓存 Cookie 仅用账号密码登录；缓存命中不登录", async () => {
  const disk = new Map(), state = server();
  const a = await run({ disk, state, auto: false }), b = await run({ disk, state, auto: false });
  assert.equal(a.calls[0].path, "/api/auth/login"); assert.equal(b.calls.filter(c => c.path === "/api/auth/login").length, 0);
});
test("兑换 POST 超时只读核实；下次 pending 阻断新 POST", async () => {
  const state = server(), disk = new Map();
  const hook = c => c.path === "/api/me/coins/redeem" && c.method === "POST" ? { error: "RAW_SECRET_SENTINEL" } : undefined;
  const a = await run({ state, disk, hook }); assert.equal(posts(a).length, 1); assert.ok(pending(a)); assert.doesNotMatch(a.text, /续期成功/);
  const b = await run({ state, disk, hook }); assert.equal(posts(b).length, 0); assert.match(b.text, /保留 pending/);
});
test("兑换超时但服务端已扣费可只读确认，仍只有一个 POST", async () => {
  const r = await run({ hook: c => {
    if (c.path === "/api/me/coins/redeem" && c.method === "POST") { c.state.date = dateAt(59); c.state.coins -= 90; return { error: "mock timeout" }; }
  } }); assert.equal(posts(r).length, 1); assert.match(r.text, /续期成功/); assert.equal(pending(r), null);
});
test("日期未变即使扣了积分也不得报成功", async () => {
  const r = await run({ state: server({ keepDate: true }) }); assert.ok(pending(r)); assert.doesNotMatch(r.text, /续期成功/);
});
test("日期增加但积分未扣费不成功；保留 pending", async () => {
  const r = await run({ hook: c => { if (c.path === "/api/me/coins/redeem" && c.method === "POST") { c.state.date = dateAt(59); return { status: 200, body: {} }; } } });
  assert.ok(pending(r)); assert.doesNotMatch(r.text, /续期成功/);
});
for (const status of [302, 400, 403, 500]) test("未知 HTTP " + status + "不重放 POST 且保留 pending", async () => {
  const r = await run({ hook: c => c.path === "/api/me/coins/redeem" && c.method === "POST" ? { status, body: { message: "RAW_SECRET_SENTINEL" } } : undefined });
  assert.equal(posts(r).length, 1); assert.ok(pending(r)); assert.doesNotMatch(r.text, /续期成功/);
});
test("明确400积分不足可释放 pending", async () => {
  const r = await run({ hook: c => c.path === "/api/me/coins/redeem" && c.method === "POST" ? { status: 400, body: { code: "INSUFFICIENT_COINS" } } : undefined });
  assert.equal(pending(r), null); assert.match(r.text, /服务端明确余额不足/);
});
test("403 锁定/验证错误不重登不重放签到 POST", async () => {
  const r = await run({ state: server({ can: true }), auto: false,
    hook: c => c.path === "/api/me/checkin" && c.method === "POST" ? { status: 403, body: { message: "验证错误，账号已锁定" } } : undefined });
  assert.equal(r.state.logins, 1); assert.equal(r.calls.filter(c => c.method === "POST" && c.path === "/api/me/checkin").length, 1);
});
test("403 明确 SESSION_EXPIRED 才可重登", async () => {
  const r = await run({ auto: false, hook: c => c.path === "/api/me/checkin" && c.nth === 1 ? { status: 403, body: { code: "SESSION_EXPIRED" } } : undefined });
  assert.equal(r.state.logins, 2);
});
test("pending 后来得到双重证明才释放且本轮不再兑换", async () => {
  const state = server(), disk = new Map();
  const a = await run({ state, disk, hook: c => c.method === "POST" && c.path === "/api/me/coins/redeem" ? { error: "mock timeout" } : undefined });
  assert.ok(pending(a)); state.coins = 89; state.date = dateAt(59);
  const b = await run({ state, disk, auto: false }); assert.equal(posts(b).length, 0); assert.equal(pending(b), null); assert.match(b.text, /续期成功/);
});
test("账号隔离 Cookie/pending/每日记录，切回仍受 pending 保护", async () => {
  const disk = new Map(), state = server();
  await run({ disk, state, hook: c => c.method === "POST" && c.path === "/api/me/coins/redeem" ? { error: "mock" } : undefined });
  const b = await run({ disk, state: server(), username: "mock-account-B", auto: false });
  assert.equal(b.state.logins, 1); assert.ok(b.calls.filter(c => c.path !== "/api/auth/login").every(c => c.options.headers.Cookie === "stream_session=mock-session-mock-account-B"));
  const a = await run({ disk, state }); assert.equal(posts(a).length, 0);
});
for (const html of ["<article><h2>当前订阅</h2>永久会员 到期：2026/12/01</article>",
  "<form action='/login'><input type='password'></form><article><h2>当前订阅</h2>到期：2026/12/01</article>"]) {
  test("永久/HTML登录页不兑换 " + tests.length, async () => { const r = await run({ state: server({ html }) }); assert.equal(posts(r).length, 0); });
}
test("兑换天数受余额和服务端maxDays双重限制", async () => {
  const r = await run({ state: server({ coins: 44, config: { membershipEnabled: true, membershipCostPerDay: 3, membershipMinDays: 10, membershipMaxDays: 12 } }) });
  assert.equal(posts(r)[0].data.days, 12);
});
for (const part of ["cookie", "pending"]) test("store.save(" + part + ")失败不能静默或继续扣费", async () => {
  const r = await run({ writeFail: k => k.endsWith("." + part) }); assert.equal(posts(r).length, 0); assert.match(r.text, /本地保存失败/);
});
test("已有运行锁阻止请求；过期锁可接管", async () => {
  const disk = new Map([[key("mock-account-A", "lock"), JSON.stringify({ token: "other-owner", expiresAt: NOW + 240000 })]]);
  const a = await run({ disk }); assert.equal(a.calls.length, 0); assert.match(a.text, /已有任务/);
  const b = await run({ disk, now: NOW + 240001, auto: false }); assert.ok(b.calls.length > 0);
});
test("只释放自有 token，失去锁不能提交兑换", async () => {
  const r = await run({ hook: c => {
    if (c.path === "/account") c.disk.set(key("mock-account-A", "lock"), JSON.stringify({ token: "new-owner", expiresAt: NOW + 300000 }));
  } }); assert.equal(posts(r).length, 0); assert.equal(JSON.parse(r.disk.get(key("mock-account-A", "lock"))).token, "new-owner");
});
test("损坏 pending 安全阻断", async () => {
  const r = await run({ disk: new Map([[key("mock-account-A", "pending"), "not-json"]]) }); assert.equal(posts(r).length, 0); assert.match(r.text, /记录损坏/);
});
test("空账号或密码不发送任何 HTTP", async () => {
  for (const args of [{ username: "" }, { password: "" }]) { const r = await run(args); assert.equal(r.calls.length, 0); assert.match(r.text, /填写账号和密码/); }
});
for (const fields of [
  { canCheckin: false, locked: true, lastCheckinAt: new Date(NOW).toISOString() },
  { canCheckin: false, locked: false, lastCheckinAt: null },
  { canCheckin: false, locked: false, lastCheckinAt: "invalid" },
  { canCheckin: false, locked: false, lastCheckinAt: "2026-11-25T00:00:00Z" }
]) test("200但无本周期有效签到时间或已锁不得假成功 " + JSON.stringify(fields), async () => {
  const r = await run({ state: server({ can: true }), auto: false, hook: c => {
    if (c.path === "/api/me/checkin" && c.method === "POST") return { status: 200, body: {} };
    if (c.path === "/api/me/checkin" && c.method === "GET" && c.nth === 2) return { status: 200, body: fields };
  } }); assert.doesNotMatch(r.text, /签到成功|签到状态已更新/); assert.match(r.text, /签到未确认/);
});
test("07点上周期签过，08:10新周期仍可签到", async () => {
  const r = await run({ state: server({ can: true, last: "2026-11-25T23:00:00Z" }), auto: false, now: NOW + 10 * 60000 });
  assert.equal(r.state.checkins, 1); assert.match(r.text, /签到成功/);
});
test("23点至午夜不跨08点周期，不重复POST；08点后可提交", async () => {
  const disk = new Map(), state = server({ can: true });
  const hook = c => c.path === "/api/me/checkin" && c.method === "POST" ? { error: "mock timeout" } : undefined;
  const a = await run({ state, disk, auto: false, hook, now: Date.parse("2026-11-26T15:00:00Z") });
  const b = await run({ state, disk, auto: false, hook, now: Date.parse("2026-11-26T16:10:00Z") });
  const c = await run({ state, disk, auto: false, hook, now: Date.parse("2026-11-27T00:10:00Z") });
  assert.equal(a.calls.filter(x => x.path === "/api/me/checkin" && x.method === "POST").length, 1);
  assert.equal(challengeCalls(b).length, 0);
  assert.equal(c.calls.filter(x => x.path === "/api/me/checkin" && x.method === "POST").length, 1);
});
test("本08点周期已签，即使canCheckin=true也不消费补签", async () => {
  const r = await run({ state: server({ can: true, last: new Date(NOW).toISOString() }), auto: false, now: NOW + 60000 });
  assert.equal(challengeCalls(r).length, 0);
});
test("interval模式同自然日到期后可签到，不按午夜硬挡", async () => {
  const r = await run({ state: server({ can: true, last: "2026-11-25T23:00:00Z", checkinFields: {
    config: { mode: "interval" }, nextCheckinAt: "2026-11-26T00:00:00Z"
  } }), auto: false, now: NOW + 60000 }); assert.equal(r.state.checkins, 1); assert.match(r.text, /签到成功/);
});
test("interval的nextCheckinAt尚未到达时不取挑战", async () => {
  const r = await run({ state: server({ can: true, checkinFields: {
    config: { mode: "interval" }, nextCheckinAt: "2026-11-27T00:00:00Z"
  } }), auto: false }); assert.equal(challengeCalls(r).length, 0);
});
test("并发签到完成且时间落在本周期可确认状态而非盲信false", async () => {
  const r = await run({ state: server({ can: true }), auto: false, hook: c => {
    if (c.path === "/api/me/checkin" && c.method === "POST") { c.state.can = false; c.state.last = new Date(NOW).toISOString(); return { status: 409, body: {} }; }
  } }); assert.match(r.text, /签到状态已更新/); assert.doesNotMatch(r.text, /签到成功/);
});
for (const raw of ["false", "0", '""', "[]", "{}", ""]) test("损坏pending必须阻断：" + JSON.stringify(raw), async () => {
  const disk = new Map([[key("mock-account-A", "pending"), raw]]), state = server();
  const a = await run({ disk, state }), b = await run({ disk, state });
  assert.equal(posts(a).length + posts(b).length, 0); assert.equal(disk.get(key("mock-account-A", "pending")), raw);
  assert.match(a.text, /记录损坏/);
});
for (const body of [
  { code: "UNKNOWN_OUTCOME", message: "状态未知，不是积分不足" },
  { message: "不是余额不足，结果未知" },
  { code: "INSUFFICIENT_COINS", message: "状态未知，可能已扣费" },
  { code: "INSUFFICIENT_BALANCE", success: true, coinsLeft: 89 }
]) test("400否定或矛盾响应保留pending：" + JSON.stringify(body), async () => {
  const state = server(), disk = new Map();
  const hook = c => c.method === "POST" && c.path === "/api/me/coins/redeem" ? { status: 400, body } : undefined;
  const a = await run({ state, disk, hook }), b = await run({ state, disk, hook });
  assert.equal(posts(a).length, 1); assert.ok(pending(a)); assert.equal(posts(b).length, 0);
  assert.doesNotMatch(a.text, /未扣费|服务端明确余额不足|续期成功/);
});
(async function () {
  let failed = 0;
  for (const t of tests) {
    try { await t.body(); console.log("PASS " + t.name); }
    catch (e) { failed++; console.error("FAIL " + t.name + "\n" + e.stack); }
  }
  console.log("RESULT " + (tests.length - failed) + "/" + tests.length + " passed; " + failed + " failed");
  if (failed) process.exitCode = 1;
})();
