/**
 * 小黑盒自动签到 + 每日任务 - Loon 插件脚本
 * 
 * 功能：
 * 1. 每日签到（+30H币/经验）
 * 2. 分享任意帖子到社交平台
 * 3. 分享游戏详情到社交平台
 * 4. 分享游戏评价到社交平台
 * 
 * 原理：
 * - hkey 签名从 hkey.qcciii.com 服务获取（iOS 新版签名无法纯 JS 复现）
 * - 任务上报通过 mode=report 加密通道 + data.xiaoheihe.cn
 * 
 * 配置（插件参数或环境变量）：
 * - cookie: "heybox_id#pkey=xxx;x_xhh_tokenid=xxx"（多账号 & 分隔）
 * - 可选: XHH_IMEI（设备 imei，默认内置）
 */

// ============ 配置 ============
var HKEY_SERVER = "https://hkey.qcciii.com/hkey";
var DEFAULT_IMEI = "4187fb55b1be198a";
var API_HOST = "https://api.xiaoheihe.cn";
var DATA_HOST = "https://data.xiaoheihe.cn";
var UA = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36 ApiMaxJia/1.0";
var REFERER = "http://api.maxjia.com/";
var DEVICE_INFO = "XiaoMi 13私人定制版";
var NONCE_SIGN = "tb6e1k7WqQCIHToyzWzI8Ogq9d0EIgpb";  // API 请求 nonce
var NONCE_REPORT = "fSz04CwxvcWzG737aFNKKxNeGZDFOqJ1"; // data_report nonce

// ============ 工具 ============
function getEnv(name) {
  try {
    if (typeof $persistentStore !== "undefined") {
      var v = $persistentStore.read(name);
      if (v) return v;
    }
  } catch (e) {}
  try {
    if (typeof $argument !== "undefined" && $argument !== null && $argument !== "") {
      var arg = $argument;
      // Loon 可能传已解析的对象，也可能是 JSON 字符串（数组或对象）
      if (typeof arg === "string") {
        try { arg = JSON.parse(arg); } catch (e) {}
      }
      if (arg && typeof arg === "object") {
        if (Array.isArray(arg)) {
          // 数组格式: ["cookie值","true","false"]（按 argument=[{a},{b},{c}] 顺序）
          var idxMap = { cookie: 0, cron_expr: 0, enable_tasks: 1, debug: 2, auto_cookie: 0, name: 0, region: 1 };
          if (idxMap[name] !== undefined && arg[idxMap[name]] !== undefined) {
            return String(arg[idxMap[name]]);
          }
        } else {
          // 对象格式: {cookie:"...", enable_tasks:"true"} — Loon 标准行为 $argument.name
          if (arg[name] !== undefined) return String(arg[name]);
          // 大小写不敏感兜底
          for (var k in arg) {
            if (String(k).toLowerCase() === String(name).toLowerCase()) return String(arg[k]);
          }
        }
      }
    }
  } catch (e) {}
  return "";
}

function log(msg) { console.log("[小黑盒] " + msg); }

function bodyToString(body) {
  if (typeof body === "string") return body;
  if (body && typeof body.length === "number") {
    var s = "";
    for (var i = 0; i < body.length; i++) s += String.fromCharCode(body[i]);
    return s;
  }
  return String(body || "");
}

function randomUUID() {
  var s = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  return s;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function httpGet(url, headers) {
  return new Promise(function (resolve, reject) {
    $httpClient.get({ url: url, headers: headers || {}, timeout: 20000 }, function (error, response, data) {
      if (error) return reject(new Error(error));
      resolve({ status: response.status, body: bodyToString(data) });
    });
  });
}

function httpPost(url, headers, body) {
  return new Promise(function (resolve, reject) {
    $httpClient.post({ url: url, headers: headers || {}, body: body || "", timeout: 20000 }, function (error, response, data) {
      if (error) return reject(new Error(error));
      resolve({ status: response.status, body: bodyToString(data) });
    });
  });
}

/**
 * 解析任务的 award_desc_v2，返回 {exp, coin, battery}
 * 币种由 icon 文件名区分（服务端不返回币种名，经验/H币/盒电各用固定图标）：
 *   b9aca51c41694ca32f36f4a16d980c40.png = 经验
 *   c10d89ae4e547bee22c53412eb7b9946.png = H币
 *   e63b192a7acf06a5c6286a830593ee07.png = 盒电
 * 非 "+数字" 的 desc（如"进入选题推荐页面…"）是任务说明，忽略。
 */
var AWARD_ICON_EXP = "b9aca51c41694ca32f36f4a16d980c40.png";
var AWARD_ICON_COIN = "c10d89ae4e547bee22c53412eb7b9946.png";
var AWARD_ICON_BATTERY = "e63b192a7acf06a5c6286a830593ee07.png";

function parseAwards(list) {
  var out = { exp: 0, coin: 0, battery: 0 };
  if (!list || !list.length) return out;
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    var m = /^\+(\d+)$/.exec(String(a.desc || "").trim());
    if (!m) continue;
    var v = parseInt(m[1], 10);
    var icon = String(a.icon || "");
    if (icon.indexOf(AWARD_ICON_EXP) !== -1) out.exp += v;
    else if (icon.indexOf(AWARD_ICON_COIN) !== -1) out.coin += v;
    else if (icon.indexOf(AWARD_ICON_BATTERY) !== -1) out.battery += v;
  }
  return out;
}

/**
 * 结算用户信息 + 预计升级天数
 * 关键：升级天数用「今日实际所得 dailyGain」推算，而不是假定的固定值；
 *      若今日已完成全部任务（无新增），则用本轮理论日收益 dailyExp 兜底。
 */
function buildInfoLines(user, dailyExp, dailyGain) {
  var out = [];
  if (!user) return out;
  var li = user.level_info || {};
  var coin = li.coin, level = li.level, exp = li.exp, maxExp = li.max_exp;
  var battery = user.battery;
  if (coin === undefined && level === undefined) return out;

  out.push("💰 H币: " + coin + " | ⚡盒电: " + battery + " | Lv." + level + " | 经验 " + exp + "/" + maxExp);

  var remain = maxExp - exp;
  if (remain <= 0) return out;
  // 优先用今日真实所得推算；拿不到再退回理论日收益
  var perDay = (dailyGain && dailyGain > 0) ? dailyGain : (dailyExp || 0);
  if (perDay <= 0) return out;
  var days = Math.ceil(remain / perDay);
  out.push("⏳ 预计升级: 约" + days + "天（按每日 +" + perDay + "经验）");
  return out;
}

// 深度遍历找含指定字段的对象
function collectByKeys(node, keys, limit, out) {
  out = out || [];
  if (!node || typeof node !== "object" || out.length >= limit) return out;
  if (!Array.isArray(node)) {
    var has = true;
    for (var i = 0; i < keys.length; i++) {
      if (!(keys[i] in node)) { has = false; break; }
    }
    if (has) out.push(node);
    if (out.length >= limit) return out;
  }
  for (var k in node) {
    collectByKeys(node[k], keys, limit, out);
    if (out.length >= limit) break;
  }
  return out;
}

// ============ 签名与请求 ============

/**
 * 获取 hkey 签名（mode=request 或 mode=report）
 */
async function getHkey(mode, path, timeSec, text, imei, heyboxId) {
  if (mode === "request") {
    var url = HKEY_SERVER + "?mode=request&path=" + encodeURIComponent(path) +
      "&time=" + timeSec + "&imei=" + imei + "&heybox_id=" + heyboxId;
    var resp = await httpGet(url, { "User-Agent": UA, "Accept": "application/json" });
    var data = JSON.parse(resp.body);
    if (data.status !== "ok" || !data.result || !data.result.hkey) {
      throw new Error("hkey 服务失败: " + resp.body.slice(0, 200));
    }
    return data.result;
  } else {
    // mode=report
    var body = JSON.stringify({
      mode: "report",
      path: path,
      text: text,
      time: String(timeSec),
      imei: imei,
      heybox_id: heyboxId
    });
    var resp2 = await httpPost(HKEY_SERVER, { "Content-Type": "application/json" }, body);
    var data2 = JSON.parse(resp2.body);
    if (data2.status !== "ok" || !data2.result) {
      throw new Error("hkey report 失败: " + resp2.body.slice(0, 200));
    }
    return data2.result;
  }
}

/**
 * 带签名的 API GET 请求
 */
async function signedGet(account, path, extraParams) {
  var timeSec = Math.floor(Date.now() / 1000);
  var hk = await getHkey("request", path, timeSec, null, account.imei, account.heyboxId);
  var query = "heybox_id=" + account.heyboxId +
    "&imei=" + account.imei +
    "&device_info=" + encodeURIComponent(DEVICE_INFO) +
    "&nonce=" + NONCE_SIGN +
    "&hkey=" + hk.hkey +
    "&os_type=Android&x_os_type=Android&x_client_type=mobile" +
    "&os_version=9&version=" + hk.version + "&build=" + hk.build +
    "&_time=" + timeSec +
    "&dw=428&channel=heybox_xiaomi&x_app=heybox" +
    (extraParams ? "&" + extraParams : "");
  var resp = await httpGet(API_HOST + path + "?" + query, {
    "Cookie": account.cookie,
    "User-Agent": UA,
    "Referer": REFERER,
    "Accept": "*/*"
  });
  return JSON.parse(resp.body);
}

/**
 * 加密上报（mode=report → data.xiaoheihe.cn/account/data_report/）
 */
async function sendReport(account, textPayload, sessionId) {
  var timeSec = Math.floor(Date.now() / 1000);
  var hk = await getHkey("report", "/account/data_report/", timeSec, textPayload, account.imei, account.heyboxId);
  var query = "type=104&time_=" + hk.time +
    "&session_id=" + sessionId +
    "&heybox_id=" + account.heyboxId +
    "&imei=" + account.imei +
    "&device_info=" + encodeURIComponent(DEVICE_INFO) +
    "&nonce=" + NONCE_REPORT +
    "&hkey=" + hk.hkey +
    "&os_type=Android&x_os_type=Android&x_client_type=mobile" +
    "&os_version=9&version=" + hk.version + "&build=" + hk.build +
    "&_time=" + hk.time +
    "&dw=428&channel=heybox_xiaomi&x_app=heybox";
  var body = "data=" + encodeURIComponent(hk.data) + "&key=" + encodeURIComponent(hk.key) + "&sid=" + hk.sid;
  var resp = await httpPost(DATA_HOST + "/account/data_report/?" + query, {
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": account.cookie,
    "User-Agent": UA,
    "Referer": REFERER
  }, body);
  return JSON.parse(resp.body);
}

/**
 * 分享事件上报（tap + success）
 */
async function shareEvent(account, source, extra) {
  var sessionId = randomUUID();
  var now = String(Math.floor(Date.now() / 1000));
  var tapPayload = JSON.stringify({
    events: [{ type: "4", path: "/share/behavior/tap", time: now, addition: Object.assign({ src: source, plat: "WechatSession" }, extra) }]
  });
  var r1 = await sendReport(account, tapPayload, sessionId);
  if (r1.status !== "ok") return "tap 上报失败: " + (r1.msg || r1.status);
  await sleep(2000);
  var now2 = String(Math.floor(Date.now() / 1000));
  var successPayload = JSON.stringify({
    events: [{ type: "3", path: "/share/behavior/success", time: now2, addition: Object.assign({ src: source, plat: "WechatSession" }, extra) }]
  });
  var r2 = await sendReport(account, successPayload, sessionId);
  if (r2.status !== "ok") return "success 上报失败: " + (r2.msg || r2.status);
  return "ok";
}

// ============ 任务实现 ============

/**
 * 任务: 分享任意帖子
 */
async function taskSharePost(account) {
  var feed = await signedGet(account, "/bbs/app/feeds", "pull=1&last_pull=1&is_first=0&list_ver=2&has_cache=1&netmode=wifi");
  if (feed.status !== "ok") return "拉取帖子流失败";
  var links = (feed.result && feed.result.links) || [];
  var post = null;
  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    if (l.link_id && l.h_src) { post = { linkId: String(l.link_id), hSrc: l.h_src }; break; }
  }
  if (!post) return "无可用帖子";

  // view_time 上报（阅读 5s）
  var now = Math.floor(Date.now() / 1000);
  var viewPayload = JSON.stringify({
    duration: [{ id: Number(post.linkId), duration: 5, duration_ms: 5000, type: "link", time: now, h_src: post.hSrc }],
    shows: [], disappear: []
  });
  var v = await sendReport(account, viewPayload, randomUUID());
  if (v.status !== "ok") return "view_time 上报失败";

  // share click
  var click = await signedGet(account, "/bbs/app/link/share/click",
    "link_id=" + post.linkId + "&h_src=" + encodeURIComponent(post.hSrc) + "&index=1");
  if (click.status !== "ok") return "分享点击失败";

  // 分享事件
  var e = await shareEvent(account, "link", { link_id: post.linkId, h_src: post.hSrc });
  if (e !== "ok") return e;
  return "ok(link_id=" + post.linkId + ")";
}

/**
 * 任务: 分享游戏详情
 */
async function taskShareGameDetail(account) {
  var rec = await signedGet(account, "/game/all_recommend/v2", "offset=0&limit=1");
  if (rec.status !== "ok") return "拉取游戏列表失败";
  var found = collectByKeys(rec.result, ["appid", "h_src"], 10, []);
  var game = null;
  for (var i = 0; i < found.length; i++) {
    var appid = String(found[i].appid);
    var hSrc = found[i].h_src;
    if (/^\d+$/.test(appid) && hSrc) { game = { appid: appid, hSrc: hSrc }; break; }
  }
  if (!game) return "无可用游戏";

  var e = await shareEvent(account, "game_detail", { app_id: game.appid, h_src: game.hSrc });
  if (e !== "ok") return e;
  return "ok(appid=" + game.appid + ")";
}

/**
 * 任务: 分享游戏评价
 */
async function taskShareGameComment(account) {
  var rec = await signedGet(account, "/game/all_recommend/v2", "offset=0&limit=1");
  if (rec.status !== "ok") return "拉取游戏列表失败";
  var found = collectByKeys(rec.result, ["appid", "h_src"], 10, []);
  var game = null;
  for (var i = 0; i < found.length; i++) {
    var appid = String(found[i].appid);
    var hSrc = found[i].h_src;
    if (/^\d+$/.test(appid) && hSrc) { game = { appid: appid, hSrc: hSrc }; break; }
  }
  if (!game) return "无可用游戏";

  var comments = await signedGet(account, "/bbs/app/link/game/comments",
    "api_version=4&offset=0&limit=30&appid=" + game.appid);
  if (comments.status !== "ok") return "拉取游戏评论失败";
  var cLinks = (comments.result && comments.result.links) || [];
  var comment = null;
  for (var j = 0; j < cLinks.length; j++) {
    var l = cLinks[j];
    if (l.linkid && l.userid && l.h_src) { comment = { linkId: String(l.linkid), hSrc: l.h_src }; break; }
  }
  if (!comment) return "无可用评论";

  var e = await shareEvent(account, "game_comment", { link_id: comment.linkId });
  if (e !== "ok") return e;
  return "ok(link_id=" + comment.linkId + ")";
}

// ============ 单个账号 ============
async function signAccount(account) {
  // 时间预算：多账号时单账号不能吃掉全部 timeout（否则被 Loon 强杀，通知都发不出）
  var budgetMs = parseInt(getEnv("XHH_BUDGET_MS"), 10) || 70000;
  var t0 = Date.now();
  function overBudget() { return (Date.now() - t0) > budgetMs; }
  function elapsedS() { return Math.round((Date.now() - t0) / 1000); }

  // 每日任务：默认开启；仅显式传 false/0 才关闭（兼容旧插件未传参数的情况）
  var et = getEnv("enable_tasks");
  var enableTasks = et === "" ? true : !(et === "false" || et === "0");

  // 0. 连续签到天数 + 签到状态 + 任务状态：串行请求（服务端并发会断连，稳定优先）
  var streak = 0;
  var state = null;
  var signExp = 0;
  var signCoin = 0;
  var signLine = "";
  var tasks = {};
  var user = null;
  var beforeUser = null;
  // 连签天数：从 sign_list 从尾部数连续 is_sign=true（含补签）
  try {
    var signListRes = await signedGet(account, "/task/sign_list/");
    if (signListRes.status === "ok" && signListRes.result && signListRes.result.sign_list) {
      var sl = signListRes.result.sign_list;
      for (var si = sl.length - 1; si >= 0; si--) {
        if (sl[si].is_sign) streak++;
        else break;
      }
    }
  } catch (e) {
    log("- ⚠️ 获取连签天数异常: " + e.message);
  }
  // 签到状态（sign_in_exp=经验, sign_in_coin=H币, 均为接口真实值）
  // 注意: result.level_info 是脏数据（coin=0/exp=5870/max_exp=20），不能用来统计
  try {
    state = await signedGet(account, "/task/sign_v3/get_sign_state");
    if (state && state.result) {
      if (state.result.sign_in_exp) signExp = state.result.sign_in_exp;
      if (state.result.sign_in_coin) signCoin = state.result.sign_in_coin;
    }
  } catch (e) {
    log("- ⚠️ 获取签到状态异常: " + e.message);
  }
  // 任务状态 + 用户信息
  try {
    var list = await signedGet(account, "/task/list_v2/");
    if (list.status === "ok" && list.result) {
      if (list.result.task_list) {
        for (var i = 0; i < list.result.task_list.length; i++) {
          var group = list.result.task_list[i];
          for (var j = 0; j < (group.tasks || []).length; j++) {
            var t = group.tasks[j];
            // 存 {state, award:{exp,coin,battery}}，奖励从 award_desc_v2 按 icon 解析
            tasks[t.title] = {
              state: t.state,
              award: parseAwards(t.award_desc_v2)
            };
          }
        }
      }
      if (list.result.user) {
        user = list.result.user;
        // 执行前快照：用于与执行后对比，算出今日真实所得
        var _li = user.level_info || {};
        beforeUser = {
          exp: _li.exp,
          coin: _li.coin,
          battery: user.battery,
          level: _li.level
        };
      }
    }
  } catch (e) {
    log("- ⚠️ 获取任务状态异常: " + e.message);
  }

  // 1. 签到
  log("#### 签到");
  try {
    if (state && (state.status === "relogin" || state.status === "login")) {
      log("- ❌ 登录态失效，请重新抓包更新 Cookie");
      return { ok: false, msg: "⚠️ 登录态失效，请重新抓包更新 Cookie（返回 " + state.status + "）" };
    }
    if (state && state.status === "failed") {
      log("- ❌ 接口失败: " + (state.msg || "未知"));
      return { ok: false, msg: "⚠️ 接口失败: " + (state.msg || "未知") };
    }
    if (state && state.result && state.result.state === "ok") {
      signLine = "✅ 签到 · 今日已签到";
      log("- ✅ 今日已签到");
    } else {
      log("- 今日未签到，正在签到...");
      // 签到请求带重试（网络抖动/服务端断连时重试 2 次）
      var sign = null;
      for (var retry = 0; retry < 3; retry++) {
        try {
          sign = await signedGet(account, "/task/sign_v3/sign");
          break;
        } catch (e2) {
          if (retry < 2) { log("- ⚠️ 签到请求失败，重试 " + (retry + 1) + "/2..."); await sleep(1000); }
          else { sign = null; }
        }
      }
      if (sign) {
      if (sign.status === "ok") {
        // 签到接口返回的才是真实奖励（连签 7 天以上翻倍）
        if (sign.result && sign.result.sign_in_exp) signExp = sign.result.sign_in_exp;
        if (sign.result && sign.result.sign_in_coin) signCoin = sign.result.sign_in_coin;
        if (sign.result && sign.result.state === "ignore") {
          signLine = "✅ 签到 · 今日已签到过";
          log("- ✅ 今日已签到过");
        } else {
          var coin = signCoin || 0;
          signLine = "✅ 签到 · 成功 +" + coin + "H币" +
            (signExp ? " +" + signExp + "经验" : "") + (streak ? " 连签" + streak + "天" : "");
          log("- ✅ 签到成功 +" + coin + "H币" +
            (signExp ? " +" + signExp + "经验" : "") + (streak ? " 连签" + streak + "天" : ""));
        }
      } else {
        signLine = "❌ 签到 · 失败 " + (sign.msg || sign.status);
        log("- ❌ 签到失败: " + (sign.msg || sign.status));
      }
      } else {
        signLine = "❌ 签到 · 网络异常（重试后仍失败）";
        log("- ❌ 签到失败: 网络异常（重试后仍失败）");
      }
    }
  } catch (e) {
    signLine = "❌ 签到 · 异常 " + e.message;
    log("- ❌ 签到异常: " + e.message);
  }
  if (streak > 0) log("- 🔥 连续签到: " + streak + "天");

  // 任务状态日志（逐行）
  log("#### 检查任务进行状况");
  var taskKeys = Object.keys(tasks);
  for (var k = 0; k < taskKeys.length; k++) {
    var tInfo = tasks[taskKeys[k]];
    var st = tInfo && tInfo.state;
    var icon = st === "finish" ? "✅" : (st === "waiting" ? "⏳" : "⬜");
    var suffix = st === "finish" ? " 已完成" : st === "waiting" ? " 待执行" : " (" + st + ")";
    log("- " + icon + " " + taskKeys[k] + suffix);
  }

  // 3. 每日经验：签到经验 + 任务经验（任务经验从 award_desc_v2 实读，不再硬编码 30）
  var dailyExpTask = 0;
  for (var dk = 0; dk < taskKeys.length; dk++) {
    var dInfo = tasks[taskKeys[dk]];
    if (dInfo && dInfo.award) dailyExpTask += dInfo.award.exp;
  }
  if (enableTasks && dailyExpTask === 0) dailyExpTask = 30; // 接口无奖励数据时兜底
  var dailyExp = (signExp || 0) + (enableTasks ? dailyExpTask : 0);
  if (dailyExp <= 0) dailyExp = 30;

  // 4. 每日任务：只执行 waiting（已 finish 不重复执行）
  var didRunTask = false;
  var taskResults = [];
  if (enableTasks) {
    log("---- 开始每日任务");
    try {
      // 任务标题 → 执行函数。原来是三段复制粘贴，现在数据驱动（新增任务只加一行）
      var runners = [
        { title: "分享任意帖子到社交平台", label: "分享帖子", fn: taskSharePost },
        { title: "分享游戏详情到社交平台", label: "分享游戏详情", fn: taskShareGameDetail },
        { title: "分享游戏评价到社交平台", label: "分享游戏评价", fn: taskShareGameComment }
      ];
      for (var ri = 0; ri < runners.length; ri++) {
        var runner = runners[ri];
        if (((tasks[runner.title] || {}).state) !== "waiting") {
          log("- 今日" + runner.label + "任务已完成");
          continue;
        }
        if (overBudget()) {
          log("- ⏱️ 已用 " + elapsedS() + "s 超出预算，跳过剩余任务（明日会补跑）");
          taskResults.push("⏱️ " + runner.label + " · 超时跳过（明日补跑）");
          continue;
        }
        log("#### 执行" + runner.label + "任务");
        var rr = await runner.fn(account);
        var ok = rr.indexOf("ok") === 0;
        taskResults.push(ok ? "✅ " + runner.label + " · 完成" : "❌ " + runner.label + " · " + rr);
        log(ok ? "- ✅ " + runner.label + "任务完成" : "- ❌ " + runner.label + "任务失败: " + rr);
        didRunTask = true;
      }
    } catch (e) {
      taskResults.push("❌ 每日任务 · 异常 " + e.message);
      log("- ❌ 每日任务异常: " + e.message);
    }
    if (didRunTask) log("---- 每日任务执行完毕"); else log("---- 每日任务已全部完成");
  }

  // 5. 结算：轮询任务状态直到没有 waiting（最多 3 次），最后一次结果同时用于
  //    任务进度统计 与 用户信息/今日获得差值统计。
  //    原先 5 和 5.5 各自再拉 list_v2，单账号会白多 2~3 次请求（每次还要换一次 hkey）。
  var taskProgress = "";
  var afterUser = null;
  var finalTasks = null;
  if (enableTasks && didRunTask) {
    try {
      for (var w = 0; w < 3; w++) {
        var list2 = await signedGet(account, "/task/list_v2/");
        if (list2.status !== "ok" || !list2.result) break;
        if (list2.result.task_list) finalTasks = list2.result.task_list;
        if (list2.result.user) {
          var _u = list2.result.user, _l = _u.level_info || {};
          afterUser = { exp: _l.exp, coin: _l.coin, battery: _u.battery, level: _l.level };
          user = _u; // 用最新的用户信息输出，避免显示执行前的旧值
        }
        var waitingCount = 0;
        for (var i2 = 0; i2 < (finalTasks || []).length; i2++) {
          var g2 = finalTasks[i2];
          for (var j2 = 0; j2 < (g2.tasks || []).length; j2++) {
            if (g2.tasks[j2].state === "waiting") waitingCount++;
          }
        }
        if (waitingCount === 0 || w === 2) break;
        await sleep(3000);
      }
      if (finalTasks) {
        var done = 0, total = 0, rebuilt = {};
        for (var i3 = 0; i3 < finalTasks.length; i3++) {
          var g3 = finalTasks[i3];
          for (var j3 = 0; j3 < (g3.tasks || []).length; j3++) {
            var _t3 = g3.tasks[j3];
            total++;
            if (_t3.state === "finish") done++;
            // 本次刚完成的任务，执行前是 waiting，只有这里才是 finish
            rebuilt[_t3.title] = { state: _t3.state, award: parseAwards(_t3.award_desc_v2) };
          }
        }
        taskProgress = "📊 任务进度 · " + done + "/" + total;
        tasks = rebuilt;
      }
    } catch (e) {
      log("- ⚠️ 任务结算异常: " + e.message);
    }
  } else {
    // 本次没跑任务，但仍要取最新余额，才能算出（签到带来的）今日实际所得
    try {
      var lu0 = await signedGet(account, "/task/list_v2/");
      if (lu0.status === "ok" && lu0.result && lu0.result.user) {
        var _u0 = lu0.result.user, _l0 = _u0.level_info || {};
        afterUser = { exp: _l0.exp, coin: _l0.coin, battery: _u0.battery, level: _l0.level };
        user = _u0;
      }
    } catch (e) {}
  }

  var gotExp = 0, gotCoin = 0, gotBattery = 0;
  var diffOk = false;
  if (beforeUser && afterUser) {
    var dExp = afterUser.exp - beforeUser.exp;
    var dCoin = afterUser.coin - beforeUser.coin;
    // 跨级时 exp 会归零重算，差值不可用
    if (afterUser.level === beforeUser.level && dExp >= 0 && dCoin >= 0 && (dExp > 0 || dCoin > 0)) {
      gotExp = dExp; gotCoin = dCoin;
      gotBattery = afterUser.battery - beforeUser.battery;
      diffOk = true;
    }
  }
  if (!diffOk) {
    // 兜底：累加「每日任务」组里已完成任务的 award_desc_v2
    // 关键：签到本身就是该组里的一个任务（type="sign"），不能再叠加 sign_in_exp/sign_in_coin，
    //      否则签到会被算两次。
    for (var tk in tasks) {
      var tInf = tasks[tk];
      if (!tInf || !tInf.award) continue;
      if (tInf.state !== "finish") continue;
      gotExp += tInf.award.exp;
      gotCoin += tInf.award.coin;
      gotBattery += tInf.award.battery;
    }
    // 接口没抓到任务清单时（异常情况），才退回签到接口的自报值
    if (gotExp === 0 && gotCoin === 0) {
      gotExp = signExp || 0;
      gotCoin = signCoin || 0;
    }
  }

  var gainParts = [];
  if (gotExp > 0) gainParts.push("+" + gotExp + "经验");
  if (gotCoin > 0) gainParts.push("+" + gotCoin + "H币");
  if (gotBattery > 0) gainParts.push("+" + gotBattery + "盒电");
  var gainLine = gainParts.length ? "📈 今日获得: " + gainParts.join(" / ") : "📈 今日获得: 无新增（已全部完成）";
  log(gainLine);

  // 5.6 用户信息 + 预计升级天数（最后结算：用今日真实所得推算）
  var infoLines = buildInfoLines(user, dailyExp, gotExp);
  for (var il = 0; il < infoLines.length; il++) log(infoLines[il]);

  // 6. 组装输出（通知：精简版，详细过程在控制台逐步日志）
  var lines = [];
  // 签到结果
  lines.push("📅 " + signLine);
  if (streak > 0) lines.push("🔥 连续签到: " + streak + "天");
  lines.push(gainLine);
  // 任务执行摘要
  if (enableTasks && Object.keys(tasks).length) {
    if (taskResults.length) {
      for (var tr = 0; tr < taskResults.length; tr++) lines.push(taskResults[tr]);
    } else {
      lines.push("✅ 每日任务已全部完成");
    }
    if (taskProgress) lines.push("📊 任务进度: " + taskProgress.replace("📊 任务进度 · ", ""));
  }
  // 用户信息（最后）：控制台与通知共用同一份，避免两处算法漂移
  for (var il2 = 0; il2 < infoLines.length; il2++) lines.push(infoLines[il2]);

  return { ok: true, msg: lines.join("\n") };
}

// ============ 主流程 ============
async function main() {
  var messages = [];
  var failed = false;   // 显式标记失败，不再用中文关键字猜（任务名里带"失败"会误判）
  // 读取自动捕获的 Cookie（http-request 捕获脚本写入），插件参数兜底
  // 注意：不要把 $argument 整体打进日志，它含明文 cookie
  var rawCookie = "";
  try {
    if (typeof $persistentStore !== "undefined") rawCookie = $persistentStore.read("xiaoheihe_cookie") || "";
  } catch (e) {}
  if (!rawCookie) rawCookie = getEnv("cookie") || getEnv("BLACKBOX_COOKIE") || "";
  if (!rawCookie) {
    var msg = "未配置 Cookie！请在小黑盒 App 抓包获取 pkey 和 x_xhh_tokenid，格式: heybox_id#pkey=xxx;x_xhh_tokenid=xxx";
    log(msg);
    $notification.post("小黑盒签到", "", msg);
    $done();
    return;
  }

  var accountStrs = rawCookie.split(/[&\n]/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  var accounts = [];
  for (var i = 0; i < accountStrs.length; i++) {
    var acct = accountStrs[i];
    var heyboxId = "";
    var cookie = acct;
    if (acct.indexOf("#") !== -1) {
      var parts = acct.split("#");
      heyboxId = parts[0].trim();
      cookie = parts[1].trim();
    }
    if (!cookie) continue;
    accounts.push({
      heyboxId: heyboxId,
      cookie: cookie,
      imei: getEnv("XHH_IMEI") || DEFAULT_IMEI
    });
  }

  if (accounts.length === 0) {
    $notification.post("小黑盒签到", "", "Cookie 格式错误");
    $done();
    return;
  }

  log("共 " + accounts.length + " 个账号");
  for (var i = 0; i < accounts.length; i++) {
    var account = accounts[i];
    log("账号" + (i + 1) + " (heybox_id=" + (account.heyboxId || "?") + ") 执行中...");
    try {
      var result = await signAccount(account);
      var label = account.heyboxId ? "账号 " + account.heyboxId : "账号 " + (i + 1);
      messages.push("── " + label + " ──\n" + result.msg);
      if (!result.ok) failed = true;
      // 通知内容不再打印到控制台（逐步日志已输出执行过程，避免重复）
    } catch (e) {
      var errMsg = "❌ 账号" + (i + 1) + " · 异常 " + e.message;
      messages.push(errMsg);
      failed = true;
      log(errMsg);
    }
    if (i < accounts.length - 1) await sleep(1500);
  }

  var title = failed ? "小黑盒签到 ⚠️" : "小黑盒签到";
  var joined = messages.join("\n");
  $notification.post(title, "", joined);
  log("完成");
  $done();
}

main().catch(function (e) {
  log("主流程异常: " + e.message + "\n" + (e.stack || ""));
  $notification.post("小黑盒签到 ⚠️", "", "脚本异常: " + e.message);
  $done();
});
