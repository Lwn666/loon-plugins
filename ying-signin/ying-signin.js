/* ying-signin: Loon only. No credential capture; no external dependencies. */
(async function () {
  "use strict";
  const BASE = "https://ying.wedg.top", DAY = 86400000, VERSION = "2026.11.26.3";
  const started = Date.now(), today = Math.floor((started + 8 * 3600000) / DAY);
  const result = { sign: "未执行", coins: "未知", expiry: "未知", renew: "未执行" };
  let store, token, cookie = "", recovered = false;
  function fail(code) { const e = new Error(code); e.safeCode = code; throw e; }
  function reason(e) { return e && e.safeCode || "内部异常"; }
  function int(n, min) { return Number.isSafeInteger(n) && n >= min; }
  function networkInfo(err) {
    // Never print native descriptions: they may contain request data or credentials.
    const fields = [];
    try {
      if (typeof err === "string") fields.push(err);
      else if (err && typeof err === "object") ["domain", "code", "message", "localizedDescription", "description"].forEach(function (key) {
        const value = err[key];
        if (typeof value === "string" || typeof value === "number") fields.push(key + "=" + value);
      });
    } catch (_) { return "底层错误字段不可读"; }
    const text = fields.join(" "), domain = text.match(/\b(?:NSURLErrorDomain|NSPOSIXErrorDomain|kCFErrorDomainCFNetwork|NSOSStatusErrorDomain|Loon\.HTTPError)\b/);
    const code = text.match(/\b(?:code|errno|error)\s*[=: ]\s*(-?\d{1,5})\b/i);
    const number = code ? Number(code[1]) : null;
    const symbol = text.match(/\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN)\b/);
    let kind = "";
    if (number === -1001 || /timed?\s*out|timeout|超时/i.test(text)) kind = "超时";
    else if (number !== null && number <= -1200 && number >= -1206) kind = "TLS/证书失败";
    else if (number === -1003 || number === -1006) kind = "DNS/域名解析失败";
    else if (number === -1004) kind = "连接建立失败";
    else if (number === -1005) kind = "连接中断";
    else if (number === -1009) kind = "网络不可用";
    else if (number === -999) kind = "请求取消";
    else if (/certificate|\bTLS\b|\bSSL\b|证书/i.test(text)) kind = "TLS/证书相关";
    else if (/\bDNS\b|cannot find host|resolve host|域名解析/i.test(text)) kind = "DNS/域名解析相关";
    const parts = [];
    if (domain) parts.push(domain[0] + (code ? " code=" + number : ""));
    if (symbol) parts.push(symbol[0]);
    if (kind) parts.push(kind);
    return parts.length ? parts.join("；") : "未识别底层错误";
  }
  function beijingDay(value) {
    const n = Date.parse(value);
    return Number.isFinite(n) ? Math.floor((n + 8 * 3600000) / DAY) : null;
  }
  function makeStore(account) {
    const prefix = "ying.v1." + encodeURIComponent(account) + ".";
    return {
      read(name) {
        let raw;
        try { raw = $persistentStore.read(prefix + name); }
        catch (_) { fail("本地读取失败"); }
        if (raw === null || raw === undefined) return null;
        try { return JSON.parse(raw); } catch (_) { fail("本地记录损坏"); }
      },
      save(name, value) {
        let ok = false;
        try { ok = $persistentStore.write(JSON.stringify(value), prefix + name); }
        catch (_) { fail("本地保存失败"); }
        if (ok !== true) fail("本地保存失败");
      }
    };
  }
  function ownLock() {
    const lock = store.read("lock");
    if (!lock || lock.token !== token || lock.expiresAt <= Date.now()) fail("运行锁失效");
  }
  function acquire() {
    const old = store.read("lock");
    if (old && (!int(old.expiresAt, 1) || typeof old.token !== "string")) fail("运行锁记录损坏");
    if (old && old.expiresAt > Date.now()) fail("已有任务运行：请勿同时手动和定时执行");
    token = started + "-" + Math.random().toString(36).slice(2);
    store.save("lock", { token: token, expiresAt: Date.now() + 240000 });
    ownLock();
  }
  function session(headers) {
    let found = "";
    Object.keys(headers || {}).forEach(function (key) {
      if (key.toLowerCase() !== "set-cookie") return;
      const values = Array.isArray(headers[key]) ? headers[key] : [headers[key]];
      values.forEach(function (value) {
        const m = String(value).trim().match(/(?:^|,\s*|\n\s*)stream_session=([^;,\s]+)/i);
        if (m && /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(m[1])) found = "stream_session=" + m[1];
      });
    });
    return found;
  }
  function http(method, path, data, authenticated) {
    if (Date.now() - started > 145000) fail("接近运行时限：停止新请求");
    const headers = { Origin: BASE, Referer: BASE + "/account", Accept: "application/json, text/html" };
    if (authenticated) {
      if (!/^stream_session=[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(cookie)) fail("没有可用会话");
      headers.Cookie = cookie;
    }
    const options = { url: BASE + path, headers: headers, timeout: 15000,
      "auto-redirect": false, "auto-cookie": false, insecure: false };
    if (data !== undefined) { headers["Content-Type"] = "application/json"; options.body = JSON.stringify(data); }
    const requestStarted = Date.now();
    // GET and the login POST are side-effect-free: one retry is safe.
    // Check-in and redemption POSTs are never retried here.
    const attempts = (method === "GET" || path === "/api/auth/login") ? 2 : 1;
    function once(attempt) {
      return new Promise(function (resolve, reject) {
        function error(code, detail) {
          const label = (path === "/api/auth/login" ? "登录 " : "") + method + " " + path + "：" + code +
            (attempt > 1 ? "（第" + attempt + "次）" : "") +
            "（耗时 " + Math.max(0, Date.now() - requestStarted) + "ms" + (detail ? "；" + networkInfo(detail) : "") + "）";
          const e = new Error(label); e.safeCode = label; e.retryable = true; reject(e);
        }
        try {
          $httpClient[method.toLowerCase()](options, function (err, response, body) {
            if (err) return error("网络失败或超时", err);
            const status = Number(response && (response.status !== undefined ? response.status : response.statusCode));
            if (!Number.isInteger(status) || status < 100 || status > 599) return error("响应状态无效");
            resolve({ status: status, headers: response.headers || {}, body: body });
          });
        } catch (e) { error("网络调用异常", e); }
      });
    }
    return (async function () {
      for (let attempt = 1; ; attempt++) {
        try { return await once(attempt); }
        catch (e) {
          if (!e || e.retryable !== true || attempt >= attempts) throw e;
          if (Date.now() - started > 140000) throw e;
          await new Promise(function (r) { setTimeout(r, 700); });
        }
      }
    })();
  }
  function json(response) {
    try {
      const value = JSON.parse(response.body);
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("响应格式未知");
      return value;
    } catch (_) { fail("响应格式未知"); }
  }
  async function login(args) {
    const response = await http("POST", "/api/auth/login", { identifier: args.USERNAME, password: args.PASSWORD }, false);
    if (response.status !== 200) fail("登录失败 HTTP " + response.status);
    const value = json(response), next = session(response.headers);
    if (!value.user || value.user.id === undefined || !next) fail("登录未取得有效会话");
    store.save("cookie", next);
    cookie = next;
  }
  let args;
  async function api(method, path, data) {
    let response = await http(method, path, data, true);
    // 403 can also mean locked/invalid challenge: only explicit auth semantics qualify.
    let unauthorized = response.status === 401;
    if (response.status === 403) {
      let value; try { value = json(response); } catch (_) { value = {}; }
      unauthorized = /^(UNAUTHORIZED|UNAUTHENTICATED|SESSION_EXPIRED|NOT_AUTHENTICATED|AUTH_REQUIRED)$/.test(value.code || value.error || "") ||
        /^(请先登录|未登录|登录已失效|登录已过期|会话已过期|session expired|unauthenticated|not authenticated|authentication required|unauthorized)[。.!！]?$/.test(String(value.message || "").toLowerCase());
    }
    if (unauthorized && !recovered) {
      recovered = true;
      cookie = "";
      store.save("cookie", null);
      await login(args);
      if (method !== "GET") ownLock();
      response = await http(method, path, data, true);
    }
    return response;
  }
  async function getJSON(path) {
    const response = await api("GET", path);
    if (response.status !== 200) fail("查询失败 HTTP " + response.status);
    return json(response);
  }
  function answer(question) {
    if (typeof question !== "string" || question.length > 200) fail("挑战题无效：未提交");
    const s = question.trim().replace(/^(?:请计算|计算|请回答|求值|题目)\s*[:：]?\s*/, "")
      .replace(/\s*(?:等于多少|是多少)?[\s=＝?？]*$/, "")
      .replace(/[０-９]/g, c => String(c.charCodeAt(0) - 65296))
      .replace(/[×✕＊]/g, "*").replace(/[÷／]/g, "/").replace(/[−－]/g, "-")
      .replace(/＋/g, "+").replace(/（/g, "(").replace(/）/g, ")").replace(/\s+/g, "");
    if (!s || !/^[0-9+*/()\-]+$/.test(s)) fail("挑战题无效：未提交");
    let p = 0, depth = 0;
    function safe(n) { if (!Number.isSafeInteger(n)) fail("挑战非安全整数：未提交"); return n; }
    function atom() {
      if (++depth > 24) fail("挑战题过深：未提交");
      let n;
      if (s[p] === "+" || s[p] === "-") { const minus = s[p++] === "-"; n = atom() * (minus ? -1 : 1); }
      else if (s[p] === "(") { p++; n = expr(); if (s[p++] !== ")") fail("挑战括号无效：未提交"); }
      else { const m = s.slice(p).match(/^\d+/); if (!m) fail("挑战题无效：未提交"); p += m[0].length; n = Number(m[0]); }
      depth--; return safe(n);
    }
    function term() {
      let n = atom();
      while (s[p] === "*" || s[p] === "/") {
        const op = s[p++], rhs = atom();
        if (op === "/" && (rhs === 0 || n % rhs !== 0)) fail("挑战除法非整数或除零：未提交");
        n = safe(op === "*" ? n * rhs : n / rhs);
      }
      return n;
    }
    function expr() { let n = term(); while (s[p] === "+" || s[p] === "-") { const op = s[p++], rhs = term(); n = safe(op === "+" ? n + rhs : n - rhs); } return n; }
    const n = expr(); if (p !== s.length) fail("挑战题无效：未提交"); return n;
  }
  async function checkin() {
    const before = await getJSON("/api/me/checkin");
    if (int(before.coins, 0)) result.coins = before.coins;
    if (before.canCheckin === false) { result.sign = "今日已签到或未到签到时间（无额外补签）"; return; }
    if (before.canCheckin !== true || before.enabled !== true || before.webEnabled !== true || before.locked !== false ||
      (before.lockedUntil && !(Date.parse(before.lockedUntil) <= Date.now())) ||
      (before.requireActiveMembership === true && before.isActiveMember !== true)) {
      result.sign = "签到未开放或已锁定：未提交"; return;
    }
    const cfg = before.config || {}, now = Date.now();
    let windowKey, period, periodAt;
    if (cfg.mode === "daily") {
      if (!int(cfg.dailyResetHour, 0) || cfg.dailyResetHour > 23) fail("签到重置时间未知：未提交");
      periodAt = ms => Math.floor((ms + (8 - cfg.dailyResetHour) * 3600000) / DAY);
      period = periodAt(now);
      windowKey = "daily:" + cfg.dailyResetHour + ":" + period;
      if (typeof before.lastCheckinAt === "string" && periodAt(Date.parse(before.lastCheckinAt)) === period) {
        result.sign = "本签到周期已有签到：不额外消耗补签次数"; return;
      }
    } else if (cfg.mode === "interval") {
      const next = before.nextCheckinAt == null ? null : Date.parse(before.nextCheckinAt);
      if (next !== null && !Number.isFinite(next)) fail("下次签到时间未知：未提交");
      if (next !== null && next > now) { result.sign = "未到下次签到时间：未提交"; return; }
      windowKey = "interval:" + (before.nextCheckinAt || before.lastCheckinAt || "initial");
    } else fail("签到周期模式未知：未提交");
    if (store.read("checkinAttempt") === windowKey) {
      result.sign = "本签到周期已有提交记录：不再提交"; return;
    }
    const challenge = await getJSON("/api/me/checkin/challenge");
    if ((typeof challenge.challengeId !== "string" && typeof challenge.challengeId !== "number") ||
      !String(challenge.challengeId).length) fail("挑战编号缺失：未提交");
    const n = answer(challenge.question);
    ownLock();
    store.save("checkinAttempt", windowKey);
    const submittedAt = Date.now();
    let response, postError = "";
    try { response = await api("POST", "/api/me/checkin", { challengeId: challenge.challengeId, answer: n }); }
    catch (e) { postError = reason(e); }
    let after;
    try { after = await getJSON("/api/me/checkin"); }
    catch (_) { result.sign = "签到提交后未能回读确认；今日不再提交"; return; }
    if (int(after.coins, 0)) result.coins = after.coins;
    const at = typeof after.lastCheckinAt === "string" ? Date.parse(after.lastCheckinAt) : NaN;
    const prev = typeof before.lastCheckinAt === "string" ? Date.parse(before.lastCheckinAt) : NaN;
    const changed = Number.isFinite(at) && (!Number.isFinite(prev) || at > prev);
    const unlocked = after.locked === false && (!after.lockedUntil || Date.parse(after.lockedUntil) <= Date.now());
    const proof = Number.isFinite(at) && at <= Date.now() + 60000 && unlocked &&
      (cfg.mode === "daily" ? periodAt(at) === period && (changed || after.canCheckin === false) : changed && at >= submittedAt - 60000);
    if (proof) {
      result.sign = response && response.status === 200 ? "签到成功（签到时间与未锁状态回读确认）" : "签到状态已更新（可能由并发签到完成；提交响应不确定）";
    } else result.sign = "签到未确认（" + (postError || "HTTP " + response.status) + "）；本周期不再提交";
  }
  function expiry(html) {
    if (typeof html !== "string" || html.length > 2000000) fail("到期页面格式未知");
    html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    if (/<(?:script|style|template|noscript)\b/i.test(html) || /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html)) fail("到期页面无效或为登录页");
    function text(s) { return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|&#xA0;/gi, " ").replace(/\s+/g, " ").trim(); }
    const cards = [], re = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi;
    let m;
    while ((m = re.exec(html))) { const h = m[1].match(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/i); if (h && text(h[1]) === "当前订阅") cards.push(text(m[1])); }
    if (cards.length !== 1) fail("当前订阅区不唯一或缺失");
    if (/永久|永不过期|终身|长期有效|无限期|无期限/.test(cards[0])) return { permanent: true, label: "永久会员" };
    const dates = [], dateRE = /到期(?:时间|日期)?\s*[:：]\s*(\d{4})\s*[\/年.\-]\s*(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})(?![\dT:])\s*日?/g;
    while ((m = dateRE.exec(cards[0]))) dates.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    if (dates.length !== 1) fail("页面到期日期未知或歧义");
    const [y, mo, d] = dates[0], ms = Date.UTC(y, mo - 1, d), date = new Date(ms);
    if (y < 2000 || y > 2199 || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) fail("页面到期日期无效");
    return { permanent: false, day: ms / DAY, label: y + "/" + mo + "/" + d };
  }
  async function readExpiry() {
    const response = await api("GET", "/account");
    if (response.status !== 200) fail("到期页面查询失败 HTTP " + response.status);
    const value = expiry(response.body);
    result.expiry = value.label + (value.permanent ? "" : "（剩余 " + (value.day - Math.floor((Date.now() + 8 * 3600000) / DAY)) + " 天）");
    return value;
  }
  async function readBalance() {
    const value = await getJSON("/api/me/coins/redeem");
    if (!int(value.coins, 0)) fail("积分余额格式未知");
    result.coins = value.coins;
    return value;
  }
  function validPending(p) {
    return p && p.v === 1 && int(p.expiresDay, 1) && int(p.beforeCoins, 0) && int(p.cost, 1) &&
      int(p.days, 1) && p.days <= 30 && int(p.cost * p.days, 1) && p.beforeCoins >= p.cost * p.days;
  }
  function confirmed(p, account, balance) {
    return !account.permanent && account.day > p.expiresDay && p.beforeCoins - balance.coins === p.cost * p.days;
  }
  async function verifyPending(p) {
    // Even a timeout/unknown HTTP error never causes a second redemption POST.
    try {
      const account = await readExpiry(), balance = await readBalance();
      if (confirmed(p, account, balance)) {
        ownLock(); store.save("pending", null);
        result.renew = "续期成功（到期增加且扣费 " + p.cost * p.days + " 积分已确认；本次不再兑换）";
        return;
      }
    } catch (e) { result.renew = "续期待核实（" + reason(e) + "）：保留 pending，禁止重复兑换"; return; }
    result.renew = "续期待核实：日期或扣费不符，保留 pending，禁止重复兑换";
  }
  async function renewal() {
    const pending = store.read("pending");
    if (pending !== null) {
      if (!validPending(pending)) fail("pending 记录损坏：禁止兑换，需人工核实");
      await verifyPending(pending); return;
    }
    // Always query both displays; a failed check-in does not block this phase.
    let balance, account, readError;
    try { balance = await readBalance(); } catch (e) { readError = e; }
    try { account = await readExpiry(); } catch (e) { readError = e; }
    if (args.AUTO_RENEW === false) { result.renew = "自动续期关闭（只读查询）"; return; }
    if (readError) throw readError;
    if (account.permanent) { result.renew = "永久会员：不兑换"; return; }
    const remaining = account.day - Math.floor((Date.now() + 8 * 3600000) / DAY);
    if (remaining >= 30) { result.renew = "剩余天数 >=30：不兑换"; return; }
    const cfg = balance.config || {};
    if (balance.available !== true || cfg.membershipEnabled !== true) { result.renew = "会员积分兑换未开放"; return; }
    if (!int(cfg.membershipCostPerDay, 1) || !int(cfg.membershipMinDays, 1) ||
      !int(cfg.membershipMaxDays, 1) || cfg.membershipMaxDays < cfg.membershipMinDays) fail("会员兑换配置未知：未提交");
    const days = Math.min(30, cfg.membershipMaxDays, Math.floor(balance.coins / cfg.membershipCostPerDay));
    if (days < cfg.membershipMinDays) { result.renew = "积分不足或可兑换天数低于最小值：未提交"; return; }
    const intent = { v: 1, expiresDay: account.day, beforeCoins: balance.coins,
      cost: cfg.membershipCostPerDay, days: days, createdAt: Date.now() };
    if (!validPending(intent)) fail("兑换计划无效：未提交");
    ownLock(); store.save("pending", intent); ownLock();
    let response;
    try { response = await api("POST", "/api/me/coins/redeem", { type: "membership", days: days }); }
    catch (_) { result.renew = "兑换响应不确定"; }
    // Only an explicit 400 insufficient-balance error can clear without success proof.
    if (response && response.status === 400) {
      let value;
      try { value = json(response); } catch (_) { value = {}; }
      // Deliberately narrow: bare structured refusal only. Any extra message or
      // outcome field (including contradictory text) stays pending for read-only proof.
      if (Object.keys(value).length === 1 && /^(INSUFFICIENT_COINS|INSUFFICIENT_BALANCE)$/.test(value.code || "")) {
        ownLock(); store.save("pending", null);
        result.renew = "兑换失败：服务端明确余额不足（结构化拒绝）"; return;
      }
    }
    await verifyPending(intent);
  }
  try {
    args = typeof $argument === "object" && $argument !== null && !Array.isArray($argument) ? $argument : {};
    if (typeof args.USERNAME !== "string" || !args.USERNAME.trim() || typeof args.PASSWORD !== "string" || !args.PASSWORD) fail("请在插件参数填写账号和密码");
    args = { USERNAME: args.USERNAME.trim(), PASSWORD: args.PASSWORD,
      AUTO_RENEW: args.AUTO_RENEW === undefined || args.AUTO_RENEW === null ? true : args.AUTO_RENEW };
    if (typeof args.AUTO_RENEW !== "boolean") fail("AUTO_RENEW 必须是布尔开关");
    store = makeStore(args.USERNAME);
    acquire();
    cookie = store.read("cookie") || "";
    if (!cookie) await login(args);
    try { await checkin(); } catch (e) { result.sign = "签到失败：" + reason(e); }
    try { await renewal(); } catch (e) { result.renew = "续期未执行或未确认：" + reason(e); }
  } catch (e) {
    result.sign = "未完成：" + reason(e);
    result.renew = "未提交新兑换";
  } finally {
    if (store && token) {
      try {
        const lock = store.read("lock");
        if (lock && lock.token === token) store.save("lock", null);
      } catch (e) { result.renew += "；释放运行锁失败：" + reason(e); }
    }
    const message = "签到：" + result.sign + "\n积分：" + result.coins + "\n到期：" + result.expiry + "\n续期：" + result.renew;
    try { console.log("[ying-signin " + VERSION + "] " + message); $notification.post("Ying 签到与积分续期", "", message, { openUrl: BASE + "/account" }); }
    finally { $done({}); }
  }
})();
