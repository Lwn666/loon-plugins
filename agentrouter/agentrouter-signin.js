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
 * 【插件参数】
 *   ACCOUNTS  单账号：邮箱#密码
 *             多账号：换行 / 分号 分隔
 *             分隔符兼容 # | ----
 *   DEBUG     开启后输出详细日志
 *
 * 原始 Python 参考：https://github.com/773075692/agentrouter-checkin
 * ----------------------------------------------------------------
 */

var BASE_URL = "https://agentrouter.org";
var LOGIN_PATH = "/api/user/login";
var LOG_PATH = "/api/log/self";
var TIMEOUT = 25000;
var QUOTA_PER_UNIT = 500000; // 站点 /api/status 的 quota_per_unit：1 USD = 500000 quota

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

  text.split(/[\n;]+/).forEach(function (line, i) {
    line = line.trim();
    if (!line || line.charAt(0) === "#") return;
    var p = splitAccount(line);
    if (p[0] && p[1]) {
      list.push({ name: "账号" + (list.length + 1), email: p[0], password: p[1] });
    }
  });
  return list;
}

/* ========================= 工具 ========================= */

function log(msg) {
  console.log("[AgentRouter] " + msg);
}

function toStr(d) {
  if (d === null || d === undefined) return "";
  if (typeof d === "string") return d;
  if (typeof d === "object" && d.length !== undefined) {
    // Uint8Array 归一化
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

function ago(ts) {
  var d = Math.floor(Date.now() / 1000) - Number(ts);
  if (isNaN(d) || d < 0) return "";
  if (d < 60) return d + " 秒前";
  if (d < 3600) return Math.floor(d / 60) + " 分钟前";
  if (d < 86400) return Math.floor(d / 3600) + " 小时前";
  return Math.floor(d / 86400) + " 天前";
}

/* ========================= 接口调用 ========================= */

// 登录即签到
function login(acct, dbg, cb) {
  var body = JSON.stringify({ username: acct.email, password: acct.password });
  $httpClient.post(
    {
      url: BASE_URL + LOGIN_PATH,
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Origin: BASE_URL,
        Referer: BASE_URL + "/login",
      },
      body: body,
      timeout: TIMEOUT,
    },
    function (err, resp, data) {
      if (err) return cb({ ok: false, msg: "登录请求异常：" + err });
      var text = toStr(data);
      var status = resp ? resp.status : 0;
      if (dbg) log("login HTTP " + status + " -> " + text.slice(0, 200));

      if (text.indexOf("<") === 0) {
        return cb({ ok: false, msg: "被 WAF 拦截（返回 HTML），请稍后重试" });
      }
      var j = jsonTry(text);
      if (!j) return cb({ ok: false, msg: "登录响应非 JSON：" + text.slice(0, 120) });
      if (!j.success) {
        return cb({ ok: false, msg: "登录失败：" + (j.message || text.slice(0, 120)) });
      }

      var d = j.data || {};
      cb({
        ok: true,
        uid: d.id,
        username: d.username || d.display_name || acct.email,
        quota: d.quota,
        checkedIn: !!d.checked_in,
      });
    }
  );
}

// 回查个人日志，确认签到记录
function verifyCheckin(uid, dbg, cb) {
  if (!uid) return cb({ level: "error", detail: "缺少 uid，跳过日志核验" });
  $httpClient.get(
    {
      url: BASE_URL + LOG_PATH + "?p=1&page_size=20",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "New-Api-User": String(uid),
      },
      timeout: TIMEOUT,
    },
    function (err, resp, data) {
      if (err) return cb({ level: "error", detail: "日志查询异常：" + err });
      var text = toStr(data);
      if (dbg) log("log HTTP " + (resp ? resp.status : 0) + " -> " + text.slice(0, 200));
      var j = jsonTry(text);
      if (!j || !j.data) return cb({ level: "error", detail: "日志接口返回异常" });

      var items = j.data.items || [];
      var now = Math.floor(Date.now() / 1000);
      var newestTs = null,
        newestContent = "";

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
  );
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
        quota: null,
      });
    }

    if (!r.checkedIn) {
      log(acct.name + " 🟡 登录成功但 checked_in=false（今日额度可能已发或接口变化）");
      return done({
        name: acct.name,
        email: acct.email,
        status: "success",
        msg: "登录成功，checked_in=false（可能今日额度已发）",
        quota: r.quota,
      });
    }

    verifyCheckin(r.uid, dbg, function (v) {
      var msg;
      if (v.level === "new") msg = "签到成功，日志已确认（" + v.detail + "）";
      else if (v.level === "today") msg = "签到成功（" + v.detail + "）";
      else msg = "登录成功且已签到，日志未确认：" + v.detail;
      log(acct.name + " ✅ " + msg + " | 额度 " + fmtQuota(r.quota));
      done({
        name: acct.name,
        email: acct.email,
        status: "success",
        msg: msg,
        quota: r.quota,
      });
    });
  });
}

/* ========================= 主流程 ========================= */

function main() {
  var args = readArg();
  var dbg = String(args.DEBUG) === "true" || args.DEBUG === true;
  var accounts = parseAccounts(args.ACCOUNTS);

  if (!accounts.length) {
    log("未检测到账号配置，请填写插件参数 ACCOUNTS（格式：邮箱#密码）");
    $notification.post("AgentRouter 签到", "未配置账号", "请在插件中填写 ACCOUNTS，格式：邮箱#密码");
    return $done();
  }

  log("AgentRouter 自动签到启动，共 " + accounts.length + " 个账号");

  var results = [];
  var idx = 0;

  function next() {
    if (idx >= accounts.length) return finish();
    var acct = accounts[idx++];
    runAccount(acct, dbg, function (res) {
      results.push(res);
      // 多账号之间稍作间隔，避免触发限流
      if (idx < accounts.length) {
        setTimeout(next, 2000);
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
      return tag + " " + r.name + "：" + r.msg + " | 额度 " + fmtQuota(r.quota);
    });

    var title = "AgentRouter 签到";
    var subtitle =
      failCount === 0
        ? okCount + " 个账号全部成功"
        : okCount + " 成功 / " + failCount + " 失败";

    log(subtitle);
    lines.forEach(log);

    $notification.post(title, subtitle, lines.join("\n"));
    $done();
  }

  next();
}

main();
