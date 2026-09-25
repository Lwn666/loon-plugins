/*
 * THTV 签到脚本自测：在 node 里仿真 Loon 运行时，真发请求到 satomi.cc
 * 用法：node selftest.js      （在 thtv-signin/ 目录下，或 node thtv-signin/selftest.js）
 *
 * ⚠️ 保真要点（这个文件本身就是一次事故的产物）：
 *   $httpClient 的 timeout 单位是【毫秒】（Loon 官方文档：timeout Number 默认 5000，单位为毫秒）。
 *   本文件的早期版本写成 `timeout: (o.timeout || 20) * 1000`（当秒处理），于是脚本里 timeout=20
 *   在仿真器里变成 20 秒 → 测试全绿，真机 20 毫秒必挂。
 *   **垫片语义必须与真机一致，否则测试只是在验证垫片自己的假设。**
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

const SRC = fs.readFileSync(path.join(__dirname, "thtv-signin.js"), "utf8");
const CAPTURE = fs.readFileSync(path.join(__dirname, "thtv-capture.js"), "utf8");

// 真机上的超时错误原文（Loon 脚本日志里看到的形态）
const TIMEOUT_ERR =
  'HTTPClient request failed with error:Error Domain=LNHTTPClientDomain Code=1 "Request timeout." ' +
  "UserInfo={NSLocalizedDescription=Request timeout., NSLocalizedFailureReason=Request timeout.}";

function makeEnv(store, argument, reqs, opts) {
  const notes = [], logs = [];
  opts = opts || {};
  let syntheticFired = false;

  function send(o, cb) {
    const u = new URL(o.url);
    const headers = Object.assign({}, o.header || o.headers || {});
    const body = o.body == null ? undefined : String(o.body);
    if (body !== undefined && !headers["Content-Length"]) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const timeoutMs = o.timeout == null ? 5000 : o.timeout; // 毫秒，与真机一致
    const t0 = Date.now();
    let finished = false;
    const done = (err, resp, data) => {
      if (finished) return;
      finished = true;
      reqs.push({ method: o.method || "GET", url: o.url, ms: Date.now() - t0, err: !!err });
      cb(err, resp, data);
    };

    // 故障注入：模拟"首次必超时" / "一直超时"，用来验证重试路径（不发真请求）
    const hit = t => t && o.url.indexOf(t) >= 0;
    if (hit(opts.alwaysFail) || (hit(opts.failFirst) && !syntheticFired)) {
      syntheticFired = true;
      reqs.push({ method: o.method || "GET", url: o.url, ms: 0, err: true, synthetic: true });
      return setTimeout(() => cb(TIMEOUT_ERR, null, null), 5);
    }

    // 注入：模拟 Cloudflare 托管挑战响应（403 + 挑战页），不发真请求
    if (hit(opts.mockChallenge)) {
      const html = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>' +
        '<meta http-equiv="refresh" content="360"></head><body>' +
        '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>';
      reqs.push({ method: o.method || "GET", url: o.url, ms: 0, mock: "challenge" });
      return setTimeout(() => cb(null, { status: 403, headers: { "cf-mitigated": "challenge" } }, html), 5);
    }

    // 注入：按 URL 匹配返回指定响应（可多条，用于同时 mock /api/sign-in 与 /login）
    if (opts.mockMap) {
      const m = opts.mockMap.find(x => o.url.indexOf(x.url) >= 0);
      if (m) {
        reqs.push({ method: o.method || "GET", url: o.url, ms: 0, mock: "map" });
        return setTimeout(() => cb(null, { status: m.status || 200, headers: m.headers || {} }, m.body), 5);
      }
    }

    // 注入：模拟指定 JSON 响应（用于验证结果解析分支）
    if (opts.mockJson && hit(opts.mockJsonUrl)) {
      reqs.push({ method: o.method || "GET", url: o.url, ms: 0, mock: "json" });
      return setTimeout(() => cb(null, { status: 200, headers: {} }, opts.mockJson), 5);
    }

    const r = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: o.method || "GET", headers },
      res => {
        const chunks = [];
        res.on("data", d => chunks.push(d));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const h = {};
          for (const [k, v] of Object.entries(res.headers)) h[k] = v;
          h["Set-Cookie"] = res.headers["set-cookie"] || [];
          // 故意回传字节数组，复现 Loon 有时把 body 当 Uint8Array 返回的行为
          done(null, { status: res.statusCode, headers: h }, Array.from(buf));
        });
      }
    );
    r.setTimeout(timeoutMs, () => {
      r.destroy();
      done(TIMEOUT_ERR, null, null); // 真机超时回调 err，resp 为 null
    });
    r.on("error", e => done("HTTPClient request failed with error:" + e.message, null, null));
    if (body !== undefined) r.write(body);
    r.end();
  }

  return {
    $notification: { post: (title, subtitle, body) => notes.push({ title, subtitle, body }) },
    $persistentStore: {
      read: k => store[k],
      write: (v, k) => { store[k] = v; return true; },
      remove: k => { delete store[k]; }
    },
    $argument: argument || {},
    $request: opts.request || {},
    console: { log: s => logs.push(String(s)) },
    $done: null,
    $httpClient: { get: (o, cb) => send(Object.assign({ method: "GET" }, o), cb), post: (o, cb) => send(Object.assign({ method: "POST" }, o), cb) },
    __notes: notes,
    __logs: logs
  };
}

function runScript(src, store, argument, opts) {
  return new Promise((resolve, reject) => {
    const reqs = [];
    const env = makeEnv(store, argument, reqs, opts);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ notes: env.__notes, logs: env.__logs, reqs, store });
    };
    const timer = setTimeout(finish, 150000); // 兜底：脚本没调 $done 也要有结论
    env.$done = () => { clearTimeout(timer); setTimeout(finish, 50); };
    const keys = Object.keys(env).filter(k => k.indexOf("__") !== 0);
    try {
      new Function(...keys, src + "\n;")(...keys.map(k => env[k]));
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/* ---------------- 测试用例 ---------------- */
const MAIL = "test@example.com";
const BAD_ACCT = MAIL + "#definitely-wrong-password-123";
const BOGUS_SESSION_KEY = "thtv_session_" + MAIL; // ckKey("session", MAIL)
const BOGUS_LOGINTOKEN_KEY = "thtv_login_token_" + MAIL; // ckKey("login_token", MAIL)

const cases = [
  {
    name: "① timeout 单位回归：TIMEOUT=20ms（真机症状复现）",
    src: SRC.replace(/const TIMEOUT = \d+;/, "const TIMEOUT = 20;"),
    args: { ACCOUNTS: BAD_ACCT, DEBUG: true },
    store: {},
    check: r => r.sub === "❌ 失败" && /Request timeout/i.test(r.body)
  },
  {
    name: "② 登录被拒 → 如实回传服务器原话（mock 服务端，站点 CF 期间不再真发）",
    src: SRC,
    args: { ACCOUNTS: BAD_ACCT, DEBUG: true },
    store: {},
    opts: { mockMap: [{ url: "/login", body: '{"success":false,"message":"邮箱或密码错误"}' }] },
    check: r => r.sub === "❌ 失败" && /邮箱或密码错误/.test(r.body)
  },
  {
    name: "③ 未配置账号",
    src: SRC,
    args: {},
    store: {},
    check: r => /未配置账号/.test(r.sub)
  },
  {
    name: "④ 无缓存 cookie 且未提供密码",
    src: SRC,
    args: { ACCOUNTS: MAIL },
    store: {},
    check: r => r.sub === "❌ 失败" && /无缓存 cookie 且未提供密码/.test(r.body)
  },
  {
    name: "⑤ 有(未登录) cookie + 未配密码 → 签到被拒，提示去登录（mock）",
    src: SRC,
    args: { ACCOUNTS: MAIL, DEBUG: true },
    store: { [BOGUS_SESSION_KEY]: "00000000-0000-0000-0000-000000000000" },
    opts: { mockMap: [{ url: "/api/sign-in", body: '{"success":false,"message":"请先登录"}' }] },
    check: r => r.sub === "🔑 需要登录"
  },
  {
    name: "⑥ 有(未登录) cookie + 错误密码 → 自动换票被触发并如实报错（mock）",
    src: SRC,
    args: { ACCOUNTS: BAD_ACCT, DEBUG: true },
    store: { [BOGUS_SESSION_KEY]: "00000000-0000-0000-0000-000000000000" },
    opts: {
      mockMap: [
        { url: "/api/sign-in", body: '{"success":false,"message":"请先登录"}' },
        { url: "/login", body: '{"success":false,"message":"邮箱或密码错误"}' }
      ]
    },
    check: (r, ctx) => r.sub === "❌ 失败" && /换票失败/.test(r.body) && /邮箱或密码错误/.test(r.body)
      && ctx.reqs.filter(q => q.url.indexOf("/login") >= 0).length === 1
  },
  {
    name: "⑦ 首次请求超时 → 自动重试后拿到服务器原话（故障注入 + mock）",
    src: SRC,
    args: { ACCOUNTS: BAD_ACCT, DEBUG: true },
    store: {},
    opts: {
      failFirst: "/login",
      mockMap: [{ url: "/login", body: '{"success":false,"message":"邮箱或密码错误"}' }]
    },
    check: (r, ctx) => /邮箱或密码错误/.test(r.body) && ctx.reqs.length === 2 && ctx.reqs[0].synthetic
  },
  {
    name: "⑧ 一直超时 → 只重试 1 次，如实报错（不无限重试）",
    src: SRC,
    args: { ACCOUNTS: BAD_ACCT, DEBUG: true },
    store: {},
    opts: { alwaysFail: "/login" },
    check: (r, ctx) =>
      r.sub === "❌ 失败" && /Request timeout/i.test(r.body) && ctx.reqs.length === 2 && ctx.reqs[1].synthetic
  },
  {
    name: "⑨ CF 托管挑战 → 提示被拦截，且绝不触发换票（回归：旧版报「换票失败 登录失败 HTTP 403」）",
    src: SRC,
    args: { ACCOUNTS: BAD_ACCT, DEBUG: true },     // 故意配了密码：旧版会拿它去换票
    store: { [BOGUS_SESSION_KEY]: "00000000-0000-0000-0000-000000000000" },
    opts: { mockChallenge: "/api/sign-in" },
    check: (r, ctx) =>
      r.sub === "🚧 CF拦截" &&
      /Cloudflare 托管挑战/.test(r.body) &&
      ctx.reqs.filter(q => q.url.indexOf("/login") >= 0).length === 0 &&   // 没去换票
      ctx.reqs.filter(q => q.url.indexOf("/api/sign-in") >= 0).length === 2 // 挑战重试了 1 次
  },
  {
    name: "⑩ 签到成功响应无 success 字段 → 判成功（真机实测形态）",
    src: SRC,
    args: { ACCOUNTS: MAIL },
    store: { [BOGUS_SESSION_KEY]: "cafebabe-cafe-cafe-cafe-cafebabecafe" },
    opts: {
      mockJson: '{"currentExp":3525,"level":{"minExp":3000,"level":9,"nextLevel":6000}}',
      mockJsonUrl: "/api/sign-in"
    },
    check: r => r.sub === "✅ 成功" && /经验 3525/.test(r.body) && /Lv9/.test(r.body)
  },
  {
    name: "⑪ 今日已签响应 → 判已签",
    src: SRC,
    args: { ACCOUNTS: MAIL },
    store: { [BOGUS_SESSION_KEY]: "cafebabe-cafe-cafe-cafe-cafebabecafe" },
    opts: { mockJson: '{"success":false,"message":"今天已经签到过了"}', mockJsonUrl: "/api/sign-in" },
    check: r => r.sub === "ℹ️ 今日已签" && /已经签到过/.test(r.body)
  },
  {
    // 真发请求的冒烟用例：只要求"能区分出凭证问题与站点拦截"，具体是哪种取决于站点当前 CF 状态
    name: "⑫ 真机冒烟：假 SESSION 真发请求 → 必须是「需登录」或「CF拦截」二者之一",
    src: SRC,
    args: { ACCOUNTS: MAIL, DEBUG: true },
    store: { [BOGUS_SESSION_KEY]: "00000000-0000-0000-0000-000000000000" },
    check: (r, ctx) =>
      (r.sub === "🔑 需要登录" || r.sub === "🚧 CF拦截") &&
      ctx.reqs.filter(q => q.url.indexOf("/api/sign-in") >= 0).length >= 1
  },
  {
    name: "⑬ 捕获脚本：浏览器带 cf_clearance+UA+登录态（单账号）→ 三样都落库",
    src: CAPTURE,
    args: { ACCOUNTS: MAIL, DEBUG: true },
    store: {},
    opts: {
      request: {
        url: "https://satomi.cc/api/sign-in",
        method: "POST",
        headers: {
          "Cookie": "cf_clearance=CFTOKEN123; loginToken=UID9999_0123456789abcdef0123456789abcdef; SESSION=FAKE_SESSION_VALUE_00",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1"
        }
      }
    },
    check: (r, ctx) =>
      ctx.store["CF_CLEARANCE"] === "CFTOKEN123" &&
      /iPhone; CPU iPhone OS 18_0/.test(ctx.store["UA_OVERRIDE"] || "") &&
      ctx.store[BOGUS_LOGINTOKEN_KEY] === "UID9999_0123456789abcdef0123456789abcdef" &&
      ctx.store[BOGUS_SESSION_KEY] === "FAKE_SESSION_VALUE_00" &&
      /CF 挑战令牌已更新/.test((ctx.notes[0] || {}).subtitle || "")
  },
  {
    name: "⑭ 捕获脚本：只有匿名 SESSION（无 loginToken）→ 只存 cf_clearance，绝不回写 SESSION",
    src: CAPTURE,
    args: { ACCOUNTS: MAIL, DEBUG: true },
    store: {},
    opts: {
      request: {
        url: "https://satomi.cc/login",
        method: "GET",
        headers: {
          "Cookie": "cf_clearance=CFTOKEN456; SESSION=ANONYMOUS_SESSION_SHOULD_NOT_BE_SAVED",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1"
        }
      }
    },
    check: (r, ctx) =>
      ctx.store["CF_CLEARANCE"] === "CFTOKEN456" &&
      ctx.store[BOGUS_SESSION_KEY] === undefined &&
      ctx.store["thtv_captured_session"] === undefined
  },
  {
    name: "⑮ 捕获脚本：多账号时不回写凭证（避免串号），cf_clearance 照常存",
    src: CAPTURE,
    args: { ACCOUNTS: "a@x.com#p1\nb@x.com#p2", DEBUG: true },
    store: {},
    opts: {
      request: {
        url: "https://satomi.cc/api/sign-in",
        method: "POST",
        headers: {
          "Cookie": "cf_clearance=CFTOKEN789; loginToken=UID1479_deadbeefdeadbeefdeadbeefdeadbeef; SESSION=abc",
          "User-Agent": "UA-X"
        }
      }
    },
    check: (r, ctx) =>
      ctx.store["CF_CLEARANCE"] === "CFTOKEN789" &&
      Object.keys(ctx.store).filter(k => k.indexOf("thtv_login_token_") === 0).length === 0 &&
      ctx.logs.some(l => /无法判断归属/.test(l))
  }
];

(async () => {
  let pass = 0;
  const t0 = Date.now();
  for (const c of cases) {
    const ctx = await runScript(c.src, Object.assign({}, c.store), c.args, c.opts);
    const note = ctx.notes[0] || { title: "-", subtitle: "-", body: "-" };
    const r = { sub: note.subtitle, body: note.body };
    const ok = !!c.check(r, ctx);
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
    console.log(`      通知: ${note.title} - ${r.sub}: ${String(r.body).replace(/\n/g, " / ")}`);
    if (ctx.reqs.length) {
      console.log("      请求: " + ctx.reqs.map(q => `${q.method} ${q.url.replace("https://satomi.cc", "")} ${q.ms}ms${q.err ? " [err]" : ""}`).join(" | "));
    }
    if (!ok) console.log("      ↑ 期望未满足");
    console.log("");
  }
  console.log(`===== ${pass}/${cases.length} 通过（${((Date.now() - t0) / 1000).toFixed(1)}s） =====`);
  process.exit(pass === cases.length ? 0 : 1);
})();
