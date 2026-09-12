/**
 * AgentRouter 每日签到 —— Loon 版
 * ----------------------------------------------------------------
 * 站点：https://agentrouter.org   （New API 中转站）
 *
 * 【机制说明｜已对线上接口实测确认】
 * 本站没有独立的「签到」接口，所谓签到 = 每天第一次登录：
 *
 *   POST /api/user/login   {"username":"邮箱","password":"密码"}
 *     → 服务端在登录时顺带发放当日额度
 *     → 响应 data.checked_in = true
 *     → 控制台「使用日志」落一条 type=4 记录：
 *        「每日签到成功，增加额度 ＄25.000000 额度」
 *
 *   官方 FAQ 原文：「签到领＄25额度 —— 需要退出后重新登陆才会到账」
 *   前端 bundle 里 "/checkin" 出现 0 次，也没有签到 UI，
 *   签到入口就是登录本身。故本脚本 = 用账号密码登录一次，
 *   再回查 /api/log/self 确认签到日志确实落库。
 *
 * 【随机执行时间】
 * 为避免每天固定时刻请求被判定为自动化，默认在 08:00-12:00 之间
 * 随机选一个时间执行：
 *   - cron 每 15 分钟轮询一次（8-12 点内）
 *   - 当天首次轮询时生成随机偏移，写入 $persistentStore
 *   - 后续轮询对比当前时间，到达随机时间才真正执行
 *   - 成功后记录日期，当天剩余轮询静默退出
 *   窗口与轮询表达式均可在插件参数中调整。
 *
 * 【备用域名】
 * 官方备用域名 https://ps.air-outer.com 与主域名功能完全一致。
 * 主域名网络错误 / 被 WAF 拦截时自动切换备用域名重试，
 * 成功后记住可用域名，后续请求优先使用。
 *
 * 【手动触发】
 * Loon 首页 generic 脚本传入 MANUAL_RUN=true：
 *   忽略随机窗口与"今日已签到"状态，立即执行且始终推送通知。
 *
 * 【插件参数】
 *   ACCOUNTS       单账号：邮箱#密码；多账号换行 / 分号分隔
 *   RANDOM_WINDOW  随机时间窗口，默认 "08:00-12:00"
 *   FORCE          开关，忽略随机窗口立即执行（测试用）
 *   DEBUG          开关，输出详细日志
 *
 * 原始 Python 参考：https://github.com/773075692/agentrouter-checkin
 * ----------------------------------------------------------------
 */

// 主域名 + 备用域名（官方公告：ps.air-outer.com 与主域名功能完全一致）
// 网络错误 / WAF 拦截时自动切换，成功后记住可用域名
var BASE_URLS = ["https://agentrouter.org", "https://ps.air-outer.com"];
var STORE_BASE = "agentrouter_base_url";

function getBases() {
  var list = BASE_URLS.slice();
  var last = "";
  try { last = $persistentStore.read(STORE_BASE) || ""; } catch (e) {}
  if (last && list.indexOf(last) > 0) {
    // 上次成功的域名排最前
    list.splice(list.indexOf(last), 1);
    list.unshift(last);
  }
  return list;
}
var LOGIN_PATH = "/api/user/login";
var LOG_PATH = "/api/log/self";   // 不带尾斜杠：直连 200，带斜杠会 301
var SELF_PATH = "/api/user/self";
var USER_HEADER = "New-API-User"; // 站点鉴权头（大小写不敏感，与参考脚本一致）
var TIMEOUT = 25000;
var QUOTA_PER_UNIT = 500000; // 站点 /api/status 的 quota_per_unit：1 USD = 500000 quota

// 本地存储 key
var STORE_DATE = "agentrouter_signin_date";     // 最近一次签到成功的日期
var STORE_TARGET = "agentrouter_signin_target"; // 当天随机时间点 YYYY-MM-DD:偏移分钟
var STORE_FAIL = "agentrouter_fail_notified";   // 最近一次失败通知的日期
var STORE_COOKIE = "agentrouter_cookie";         // 登录后捕获的会话 Cookie

var UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/* ========================= 参数解析 ========================= */

function readArg() {
  var raw = typeof $argument === "undefined" ? null : $argument;
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  var s = raw.trim();
  if (!s) return {};
  try {
    var o = JSON.parse(s);
    if (o && typeof o === "object") return o;
  } catch (e) {}
  var out = {};
  s.split("&").forEach(function (kv) {
    var i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  });
  return out;
}

function splitAccount(line) {
  var seps = ["#", "----", "|"];
  for (var i = 0; i < seps.length; i++) {
    var idx = line.indexOf(seps[i]);
    if (idx > 0) {
      return [line.slice(0, idx).trim(), line.slice(idx + seps[i].length).trim()];
    }
  }
  return [line.trim(), ""];
}

function parseAccounts(raw) {
  var list = [];
  if (!raw) return list;
  var text = String(raw).trim();
  if (!text) return list;

  // 兼容 JSON 数组写法
  if (text.charAt(0) === "[") {
    try {
      var arr = JSON.parse(text);
      if (Object.prototype.toString.call(arr) === "[object Array]") {
        arr.forEach(function (a, i) {
          if (!a) return;
          var acct = a.account || "";
          var em = a.email || "";
          var pw = a.password || "";
          if (acct) {
            var p = splitAccount(acct);
            em = p[0];
            pw = p[1];
          }
          if (em && pw) {
            list.push({ name: a.name || "账号" + (i + 1), email: em, password: pw });
          }
        });
        return list;
      }
    } catch (e) {}
  }

  text.split(/[\n;]+/).forEach(function (line) {
    line = line.trim();
    if (!line || line.charAt(0) === "#") return;
    var p = splitAccount(line);
    if (p[0] && p[1]) {
      list.push({ name: "账号" + (list.length + 1), email: p[0], password: p[1] });
    }
  });
  return list;
}

/* ========================= 时间工具 ========================= */

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function nowMinutes() {
  var d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function fmtMin(m) {
  return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
}

// 解析 "08:00-12:00" -> {start, end}（单位：分钟）
function parseWindow(s) {
  var m = String(s || "").match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return { start: 8 * 60, end: 12 * 60 };
  var st = Number(m[1]) * 60 + Number(m[2]);
  var en = Number(m[3]) * 60 + Number(m[4]);
  if (en <= st) en = st + 60;
  return { start: st, end: en };
}

// 取当天随机执行时间点（分钟）；已生成过则复用
function pickTargetMin(win, today, dbg) {
  var rec = $persistentStore.read(STORE_TARGET) || "";
  var parts = String(rec).split(":");
  if (parts[0] === today && parts.length >= 2 && !isNaN(Number(parts[1]))) {
    return Number(parts[1]) + win.start;
  }
  // 留出轮询间隔，保证窗口内一定有后续触发点
  var span = Math.max(1, win.end - win.start - 10);
  var off = Math.floor(Math.random() * span);
  $persistentStore.write(today + ":" + off, STORE_TARGET);
  if (dbg) log("今日随机执行时间：" + fmtMin(win.start + off));
  return win.start + off;
}

/* ========================= 工具 ========================= */

function log(msg) {
  console.log("[AgentRouter] " + msg);
}

function toStr(d) {
  if (d === null || d === undefined) return "";
  if (typeof d === "string") return d;
  if (typeof d === "object" && d.length !== undefined) {
    var s = "";
    for (var i = 0; i < d.length; i++) s += String.fromCharCode(d[i]);
    return s;
  }
  try {
    return String(d);
  } catch (e) {
    return "";
  }
}

function jsonTry(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function fmtQuota(q) {
  var n = Number(q);
  if (q === null || q === undefined || isNaN(n)) return "未知";
  return "$" + (n / QUOTA_PER_UNIT).toFixed(2);
}

// 从用户对象解析 剩余/已用/总额（字段可能缺失）
// total 优先取服务端 total_quota，缺失则用 剩余+已用 估算
function parseQuota(u) {
  if (!u || typeof u !== "object") return { remaining: null, used: null, total: null };
  var rem = (u.quota === undefined || u.quota === null) ? null : Number(u.quota);
  var used = (u.used_quota === undefined || u.used_quota === null) ? null : Number(u.used_quota);
  var tot = (u.total_quota === undefined || u.total_quota === null) ? null : Number(u.total_quota);
  if (isNaN(rem)) rem = null;
  if (isNaN(used)) used = null;
  if (isNaN(tot)) tot = null;
  if (tot === null && rem !== null && used !== null) tot = rem + used;
  return { remaining: rem, used: used, total: tot };
}

// 组装一行额度摘要
function quotaLine(q) {
  return "剩余 " + fmtQuota(q.remaining) + "｜已用 " + fmtQuota(q.used) + "｜总额 " + fmtQuota(q.total);
}

function ago(ts) {
  var d = Math.floor(Date.now() / 1000) - Number(ts);
  if (isNaN(d) || d < 0) return "";
  if (d < 60) return d + " 秒前";
  if (d < 3600) return Math.floor(d / 60) + " 分钟前";
  if (d < 86400) return Math.floor(d / 3600) + " 小时前";
  return Math.floor(d / 86400) + " 天前";
}

/* ========================= 接口调用 ========================= */

// 从响应头里提取所有 Set-Cookie，拼成 Cookie 请求头
// 与 ddgksf2013 参考脚本一致：关闭 auto-cookie，手动管理
function extractCookie(resp) {
  if (!resp || !resp.headers) return "";
  var h = resp.headers;
  var raw = h["Set-Cookie"] || h["set-cookie"] || "";
  if (!raw) {
    // 有些实现给数组
    for (var k in h) {
      if (String(k).toLowerCase() === "set-cookie") { raw = h[k]; break; }
    }
  }
  if (!raw) return "";
  var arr = (typeof raw === "string") ? [raw] : raw;
  var parts = [];
  for (var i = 0; i < arr.length; i++) {
    // 只取 name=value，丢掉 Path/Expires 等属性
    var seg = String(arr[i]).split(";")[0].trim();
    if (seg) parts.push(seg);
  }
  return parts.join("; ");
}

// 组装鉴权请求头：Cookie + New-Api-User（缺一不可）
function authHeaders(uid, cookie) {
  var h = {
    "User-Agent": UA,
    Accept: "application/json",
  };
  h[USER_HEADER] = String(uid);
  if (cookie) h["Cookie"] = cookie;
  return h;
}

// 登录即签到（主域名失败自动切备用域名）
function login(acct, dbg, cb) {
  var bases = getBases();
  var body = JSON.stringify({ username: acct.email, password: acct.password });
  var i = 0;

  function attempt() {
    if (i >= bases.length) {
      return cb({ ok: false, msg: "主域名与备用域名均不可达（网络错误或被拦截）" });
    }
    var base = bases[i];
    $httpClient.post(
      {
        url: base + LOGIN_PATH,
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
          Origin: base,
          Referer: base + "/login",
        },
        body: body,
        timeout: TIMEOUT,
      },
      function (err, resp, data) {
        // 网络层失败 / WAF HTML / 非 JSON → 换下一个域名重试
        if (err) {
          log("域名 " + base + " 请求异常：" + err + "，尝试备用域名");
          i++;
          return attempt();
        }
        var text = toStr(data);
        var status = resp ? resp.status : 0;
        if (dbg) log("login [" + base.replace(/^https?:\/\//, "") + "] HTTP " + status + " -> " + text.slice(0, 200));

        if (text.indexOf("<") === 0) {
          log("域名 " + base + " 被 WAF 拦截（返回 HTML），尝试备用域名");
          i++;
          return attempt();
        }
        var j = jsonTry(text);
        if (!j) {
          log("域名 " + base + " 返回非 JSON，尝试备用域名");
          i++;
          return attempt();
        }
        // JSON 响应正常但登录失败（密码错误等）→ 不再换域名，直接返回
        if (!j.success) {
          return cb({ ok: false, msg: "登录失败：" + (j.message || text.slice(0, 120)) });
        }

        // 成功：记住可用域名与 cookie，后续请求复用
        try { $persistentStore.write(base, STORE_BASE); } catch (e) {}

        var cookie = extractCookie(resp);
        if (cookie) {
          try { $persistentStore.write(cookie, STORE_COOKIE); } catch (e) {}
          if (dbg) log("已捕获 Set-Cookie：" + cookie.slice(0, 60) + "...");
        } else if (dbg) {
          log("登录响应未含 Set-Cookie，后续请求将只带 uid 头");
        }

        // 兼容两种响应结构：
        //   扁平（本站实测）：data.id / data.quota / data.checked_in
        //   包装（官方文档）：data.user.id
        var d = j.data || {};
        var u = (d.user && typeof d.user === "object") ? d.user : d;
        cb({
          ok: true,
          base: base,
          cookie: cookie,
          uid: u.id || d.id,
          username: u.username || u.display_name || acct.email,
          quota: (u.quota !== undefined ? u.quota : d.quota),
          checkedIn: !!(u.checked_in !== undefined ? u.checked_in : d.checked_in),
        });
      }
    );
  }
  attempt();
}

// 查询用户信息（拿真实余额；登录响应里的 quota 常缺失）
function fetchSelf(base, uid, cookie, dbg, cb) {
  if (!base || !uid) return cb(null);
  $httpClient.get(
    {
      url: base + SELF_PATH,
      headers: authHeaders(uid, cookie),
      timeout: TIMEOUT,
      "auto-redirect": true,
    },
    function (err, resp, data) {
      if (err) { if (dbg) log("self 查询异常：" + err); return cb(null); }
      var text = toStr(data);
      if (text.charAt(0) === "<") { if (dbg) log("self 被 WAF 拦截"); return cb(null); }
      var j = jsonTry(text);
      if (!j || !j.success || !j.data) {
        if (dbg) log("self 返回异常：" + (j && j.message ? j.message : text.slice(0, 80)));
        return cb(null);
      }
      if (dbg) log("self OK quota=" + j.data.quota + " checked_in=" + j.data.checked_in);
      cb(j.data);
    }
  );
}

// 回查个人日志，确认签到记录（Cookie + New-Api-User 鉴权，失败换备用域名）
function verifyCheckin(uid, base, cookie, dbg, cb) {
  if (!uid) return cb({ level: "error", detail: "缺少 uid，跳过日志核验" });
  // cookie 可选：没有也照常请求（部分部署不校验 cookie，只看 uid 头）

  // 登录成功的域名排最前，另一个做兜底
  var bases = base
    ? [base].concat(BASE_URLS.filter(function (b) { return b !== base; }))
    : BASE_URLS.slice();
  var i = 0;

  function attempt() {
    if (i >= bases.length) {
      return cb({ level: "error", detail: "所有域名日志查询均失败" });
    }
    var host = bases[i].replace(/^https?:\/\//, "");

    $httpClient.get(
      {
        url: bases[i] + LOG_PATH + "?p=1&page_size=20",
        headers: authHeaders(uid, cookie),
        timeout: TIMEOUT,
        "auto-redirect": true,
      },
      function (err, resp, data) {
        if (err) {
          log("日志查询 [" + host + "] 异常：" + err + "，尝试备用域名");
          i++;
          return attempt();
        }

        var text = toStr(data);
        var status = resp ? resp.status : 0;
        if (dbg) log("log [" + host + "] HTTP " + status + " -> " + text.slice(0, 200));

        if (text.charAt(0) === "<") {
          log("日志查询 [" + host + "] 被 WAF 拦截，尝试备用域名");
          i++;
          return attempt();
        }

        var j = jsonTry(text);
        if (!j || !j.data) {
          var why = j && j.message ? j.message : text.slice(0, 80);
          log("日志查询 [" + host + "] 返回异常：" + why + "，尝试备用域名");
          i++;
          return attempt();
        }

        return evalItems(j.data.items || []);
      }
    );
  }

  function evalItems(items) {
    var now = Math.floor(Date.now() / 1000);
    var newestTs = null;
    var newestContent = "";

    items.forEach(function (it) {
      var c = it.content || "";
      if (c.indexOf("签到成功") >= 0 || Number(it.type) === 4) {
        var ts = Number(it.created_at);
        if (!isNaN(ts) && (newestTs === null || ts > newestTs)) {
          newestTs = ts;
          newestContent = c;
        }
      }
    });

    if (newestTs === null) {
      return cb({ level: "none", detail: "日志中未找到签到记录" });
    }
    if (newestTs >= now - 300) {
      return cb({
        level: "new",
        detail: "本次运行已生成签到日志（" + ago(newestTs) + "）",
        content: newestContent,
      });
    }
    if (newestTs >= now - 86400) {
      return cb({
        level: "today",
        detail: "今日更早已签到（" + ago(newestTs) + "），本次未新增",
        content: newestContent,
      });
    }
    return cb({
      level: "none",
      detail: "最近一条签到日志较旧（" + ago(newestTs) + "）",
      content: newestContent,
    });
  }

  attempt();
}

/* ========================= 单账号流程 ========================= */

function runAccount(acct, dbg, done) {
  log("===== 处理 " + acct.name + " (" + acct.email + ") =====");
  login(acct, dbg, function (r) {
    if (!r.ok) {
      log(acct.name + " ❌ " + r.msg);
      return done({
        name: acct.name,
        email: acct.email,
        status: "fail",
        msg: r.msg,
        quota: { remaining: null, used: null, total: null },
      });
    }

    // Cookie 兜底：响应头没给就复用上次存的
    var cookie = r.cookie || ($persistentStore.read(STORE_COOKIE) || "");

    // 登录成功：先查 self 拿真实余额（登录响应的 quota 可能缺失或为 0）
    fetchSelf(r.base, r.uid, cookie, dbg, function (selfData) {
      var quota = parseQuota(selfData || { quota: r.quota });
      var checkedIn = selfData && selfData.checked_in !== undefined
        ? !!selfData.checked_in
        : r.checkedIn;

      if (!checkedIn) {
        log(acct.name + " 🟡 登录成功但 checked_in=false（今日额度可能已发或接口变化）");
        return done({
          name: acct.name,
          email: acct.email,
          status: "success",
          msg: "登录成功，checked_in=false（可能今日额度已发）",
          quota: quota,
        });
      }

      verifyCheckin(r.uid, r.base, cookie, dbg, function (v) {
        var msg;
        if (v.level === "new") msg = "签到成功，日志已确认（" + v.detail + "）";
        else if (v.level === "today") msg = "签到成功（" + v.detail + "）";
        else msg = "登录成功且已签到（日志未确认：" + v.detail + "）";
        log(acct.name + " ✅ " + msg + " | " + quotaLine(quota));
        done({
          name: acct.name,
          email: acct.email,
          status: "success",
          msg: msg,
          quota: quota,
        });
      });
    });
  });
}

/* ========================= 随机时间闸门 ========================= */

// 返回 true 表示本次应当执行签到
// forced=true：手动触发，忽略随机窗口与"今日已签到"，直接执行
function shouldRunNow(args, dbg, forced) {
  var today = todayStr();

  if (forced) {
    log("手动触发，忽略随机窗口与当日状态，立即执行");
    return true;
  }

  // 今天已签到成功 → 静默退出（cron 轮询，避免重复签到）
  if ($persistentStore.read(STORE_DATE) === today) {
    log("今日已签到，跳过本轮轮询");
    return false;
  }

  // 手动强制
  if (String(args.FORCE) === "true" || args.FORCE === true) {
    log("FORCE 已开启，忽略随机窗口立即执行");
    return true;
  }

  var win = parseWindow(args.RANDOM_WINDOW);
  var target = pickTargetMin(win, today, dbg);
  var now = nowMinutes();
  var nowS = fmtMin(now);

  // 窗口已过 → 补跑，避免因 Loon 未运行而整日漏签
  if (now > win.end) {
    log("已过随机窗口（" + fmtMin(win.start) + "-" + fmtMin(win.end) +
        "，目标 " + fmtMin(target) + "），当前 " + nowS + " 补执行");
    return true;
  }

  if (now < target) {
    log("当前 " + nowS + "，未到随机时间 " + fmtMin(target) + "，等待下一轮（本轮不请求）");
    return false;
  }

  log("到达随机时间（目标 " + fmtMin(target) + "，当前 " + nowS + "），开始执行");
  return true;
}

/* ========================= 主流程 ========================= */

function main() {
  var args = readArg();
  var dbg = String(args.DEBUG) === "true" || args.DEBUG === true;
  // MANUAL_RUN 仅由 generic（首页手动触发）传入，用于区分手动与定时轮询
  var isManual = args.MANUAL_RUN === true || String(args.MANUAL_RUN) === "true";
  var accounts = parseAccounts(args.ACCOUNTS);

  if (!accounts.length) {
    log("未检测到账号配置，请填写插件参数 ACCOUNTS（格式：邮箱#密码）");
    $notification.post("AgentRouter 签到", "未配置账号", "请在插件中填写 ACCOUNTS，格式：邮箱#密码");
    return $done();
  }

  // 随机时间闸门（手动触发直接放行）
  if (!shouldRunNow(args, dbg, isManual)) return $done();

  var today = todayStr();
  log("AgentRouter 自动签到启动，共 " + accounts.length + " 个账号" + (isManual ? "（手动触发）" : ""));

  var results = [];
  var idx = 0;

  function next() {
    if (idx >= accounts.length) return finish();
    var acct = accounts[idx++];
    runAccount(acct, dbg, function (res) {
      results.push(res);
      if (idx < accounts.length) {
        // 多账号之间随机间隔，避免规律性请求
        setTimeout(next, 2000 + Math.floor(Math.random() * 4000));
      } else {
        finish();
      }
    });
  }

  function finish() {
    var okCount = results.filter(function (r) {
      return r.status === "success";
    }).length;
    var failCount = results.length - okCount;

    var lines = results.map(function (r) {
      var tag = r.status === "success" ? "✅" : "❌";
      var line = tag + " " + r.name + "：" + r.msg;
      if (r.status === "success") line += "\n  " + quotaLine(r.quota);
      return line;
    });

    // 全部成功 → 记录日期，当天不再轮询
    if (failCount === 0) {
      $persistentStore.write(today, STORE_DATE);
      log("已记录今日签到完成（" + today + "）");
    }

    var title = "AgentRouter 签到" + (isManual ? "（手动）" : "");
    var subtitle =
      failCount === 0
        ? okCount + " 个账号全部成功"
        : okCount + " 成功 / " + failCount + " 失败";

    log(subtitle);
    lines.forEach(log);

    // 失败只在当天首次推送，避免轮询期内重复轰炸（手动触发不受限）
    var shouldNotify = true;
    if (!isManual && failCount > 0 && $persistentStore.read(STORE_FAIL) === today) {
      shouldNotify = false;
      if (dbg) log("今日已推送过失败通知，跳过");
    }
    if (failCount > 0) $persistentStore.write(today, STORE_FAIL);

    if (shouldNotify) {
      $notification.post(title, subtitle, lines.join("\n"));
      log("已推送通知");
    }
    $done();
  }

  next();
}

main();
