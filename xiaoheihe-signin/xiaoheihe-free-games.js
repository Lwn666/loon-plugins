/**
 * 小黑盒限免游戏监控 - Loon 脚本
 * 
 * 功能：
 * 1. 定时查询小黑盒限免游戏（Epic + Steam 限时免费）
 * 2. 通知提醒：未领取的限免游戏列表 + 截止时间
 * 3. Epic 游戏提供直达领取链接（点击即领，需浏览器已登录 Epic）
 * 4. 已领取状态检测（owned 字段）
 * 
 * 原理：
 * - /mall/add_to_cart/ 接口（web 签名）返回限免列表
 * - Epic 领取 = store.epicgames.com/purchase?offers=1-{namespace}-{offerId}
 * - Steam 领取需要 WebView 注入 JS（Loon 无法执行，仅提醒去 App 领）
 * 
 * 配置：
 * - cookie: "heybox_id#pkey=xxx;x_xhh_tokenid=xxx"（多账号 & 分隔）
 * - 可选: XHH_HKEY_SERVER
 */

// ============ 配置 ============
var HKEY_SERVER = "https://hkey.qcciii.com/hkey";
var API_HOST = "https://api.xiaoheihe.cn";
var WEB_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
var WEB_VERSION = "999.0.4";
var WEB_CLIENT_VERSION = "1.3.393";

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

function log(msg) { console.log("[小黑盒限免] " + msg); }

function bodyToString(body) {
  if (typeof body === "string") return body;
  if (body && typeof body.length === "number") {
    var s = "";
    for (var i = 0; i < body.length; i++) s += String.fromCharCode(body[i]);
    return s;
  }
  return String(body || "");
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

// ============ web 签名（纯 JS 实现）============

// GF(2^8) 运算
function _d3(e) { return e & 128 ? (e << 1 ^ 27) & 255 : e << 1; }
function _mc(e) { return _d3(e) ^ e; }
function _ff(e) { return _mc(_d3(e)); }
function _lh(e) { return _ff(_mc(_d3(e))); }
function _sg(e) { return _lh(e) ^ _ff(e) ^ _mc(e); }
function _kwe(arr) {
  var e = arr.slice();
  var t = [0, 0, 0, 0];
  t[0] = _sg(e[0]) ^ _lh(e[1]) ^ _ff(e[2]) ^ _mc(e[3]);
  t[1] = _mc(e[0]) ^ _sg(e[1]) ^ _lh(e[2]) ^ _ff(e[3]);
  t[2] = _ff(e[0]) ^ _mc(e[1]) ^ _sg(e[2]) ^ _lh(e[3]);
  t[3] = _lh(e[0]) ^ _ff(e[1]) ^ _mc(e[2]) ^ _sg(e[3]);
  e[0] = t[0]; e[1] = t[1]; e[2] = t[2]; e[3] = t[3];
  return e;
}
function _awe(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
function _im(text, table, cut) {
  var sub = table.slice(0, cut);
  var r = "";
  for (var i = 0; i < text.length; i++) r += sub[text.charCodeAt(i) % sub.length];
  return r;
}
function _om(text, table) {
  var n = "";
  for (var i = 0; i < text.length; i++) n += table[text.charCodeAt(i) % table.length];
  return n;
}
function _twe(arrays) {
  var result = "";
  var maxLen = 0;
  for (var i = 0; i < arrays.length; i++) if (arrays[i].length > maxLen) maxLen = arrays[i].length;
  for (var k = 0; k < maxLen; k++) {
    for (var j = 0; j < arrays.length; j++) {
      if (k < arrays[j].length) result += arrays[j][k];
    }
  }
  return result;
}

// MD5 实现（标准纯 JS 版本，兼容 JavaScriptCore）
function md5(str) {
  function safeAdd(x, y) {
    var lsw = (x & 0xFFFF) + (y & 0xFFFF);
    var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xFFFF);
  }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];
    a = md5ff(a, b, c, d, k[0], 7, -680876936);
    d = md5ff(d, a, b, c, k[1], 12, -389564586);
    c = md5ff(c, d, a, b, k[2], 17, 606105819);
    b = md5ff(b, c, d, a, k[3], 22, -1044525330);
    a = md5ff(a, b, c, d, k[4], 7, -176418897);
    d = md5ff(d, a, b, c, k[5], 12, 1200080426);
    c = md5ff(c, d, a, b, k[6], 17, -1473231341);
    b = md5ff(b, c, d, a, k[7], 22, -45705983);
    a = md5ff(a, b, c, d, k[8], 7, 1770035416);
    d = md5ff(d, a, b, c, k[9], 12, -1958414417);
    c = md5ff(c, d, a, b, k[10], 17, -42063);
    b = md5ff(b, c, d, a, k[11], 22, -1990404162);
    a = md5ff(a, b, c, d, k[12], 7, 1804603682);
    d = md5ff(d, a, b, c, k[13], 12, -40341101);
    c = md5ff(c, d, a, b, k[14], 17, -1502002290);
    b = md5ff(b, c, d, a, k[15], 22, 1236535329);
    a = md5gg(a, b, c, d, k[1], 5, -165796510);
    d = md5gg(d, a, b, c, k[6], 9, -1069501632);
    c = md5gg(c, d, a, b, k[11], 14, 643717713);
    b = md5gg(b, c, d, a, k[0], 20, -373897302);
    a = md5gg(a, b, c, d, k[5], 5, -701558691);
    d = md5gg(d, a, b, c, k[10], 9, 38016083);
    c = md5gg(c, d, a, b, k[15], 14, -660478335);
    b = md5gg(b, c, d, a, k[4], 20, -405537848);
    a = md5gg(a, b, c, d, k[9], 5, 568446438);
    d = md5gg(d, a, b, c, k[14], 9, -1019803690);
    c = md5gg(c, d, a, b, k[3], 14, -187363961);
    b = md5gg(b, c, d, a, k[8], 20, 1163531501);
    a = md5gg(a, b, c, d, k[13], 5, -1444681467);
    d = md5gg(d, a, b, c, k[2], 9, -51403784);
    c = md5gg(c, d, a, b, k[7], 14, 1735328473);
    b = md5gg(b, c, d, a, k[12], 20, -1926607734);
    a = md5hh(a, b, c, d, k[5], 4, -378558);
    d = md5hh(d, a, b, c, k[8], 11, -2022574463);
    c = md5hh(c, d, a, b, k[11], 16, 1839030562);
    b = md5hh(b, c, d, a, k[14], 23, -35309556);
    a = md5hh(a, b, c, d, k[1], 4, -1530992060);
    d = md5hh(d, a, b, c, k[4], 11, 1272893353);
    c = md5hh(c, d, a, b, k[7], 16, -155497632);
    b = md5hh(b, c, d, a, k[10], 23, -1094730640);
    a = md5hh(a, b, c, d, k[13], 4, 681279174);
    d = md5hh(d, a, b, c, k[0], 11, -358537222);
    c = md5hh(c, d, a, b, k[3], 16, -722521979);
    b = md5hh(b, c, d, a, k[6], 23, 76029189);
    a = md5hh(a, b, c, d, k[9], 4, -640364487);
    d = md5hh(d, a, b, c, k[12], 11, -421815835);
    c = md5hh(c, d, a, b, k[15], 16, 530742520);
    b = md5hh(b, c, d, a, k[2], 23, -995338651);
    a = md5ii(a, b, c, d, k[0], 6, -198630844);
    d = md5ii(d, a, b, c, k[7], 10, 1126891415);
    c = md5ii(c, d, a, b, k[14], 15, -1416354905);
    b = md5ii(b, c, d, a, k[5], 21, -57434055);
    a = md5ii(a, b, c, d, k[12], 6, 1700485571);
    d = md5ii(d, a, b, c, k[3], 10, -1894986606);
    c = md5ii(c, d, a, b, k[10], 15, -1051523);
    b = md5ii(b, c, d, a, k[1], 21, -2054922799);
    a = md5ii(a, b, c, d, k[8], 6, 1873313359);
    d = md5ii(d, a, b, c, k[15], 10, -30611744);
    c = md5ii(c, d, a, b, k[6], 15, -1560198380);
    b = md5ii(b, c, d, a, k[13], 21, 1309151649);
    a = md5ii(a, b, c, d, k[4], 6, -145523070);
    d = md5ii(d, a, b, c, k[11], 10, -1120210379);
    c = md5ii(c, d, a, b, k[2], 15, 718787259);
    b = md5ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = safeAdd(a, x[0]);
    x[1] = safeAdd(b, x[1]);
    x[2] = safeAdd(c, x[2]);
    x[3] = safeAdd(d, x[3]);
  }
  function str2binl(str) {
    var i;
    var nblk = ((str.length + 8) >> 6) + 1;
    var blks = new Array(nblk * 16);
    for (i = 0; i < nblk * 16; i++) blks[i] = 0;
    for (i = 0; i < str.length; i++) {
      blks[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
    }
    blks[i >> 2] |= 0x80 << ((i % 4) * 8);
    blks[nblk * 16 - 2] = str.length * 8;
    return blks;
  }
  function utf8Encode(str) {
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) {
        out += String.fromCharCode(c);
      } else if (c < 2048) {
        out += String.fromCharCode(192 | (c >> 6), 128 | (c & 63));
      } else if (c >= 55296 && c <= 56319) {
        i++;
        var c2 = str.charCodeAt(i);
        c = 0x10000 + (((c & 1023) << 10) | (c2 & 1023));
        out += String.fromCharCode(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
      } else {
        out += String.fromCharCode(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      }
    }
    return out;
  }
  function binl2hex(binarray) {
    var hexTab = "0123456789abcdef";
    var str = "";
    for (var i = 0; i < binarray.length * 4; i++) {
      str += hexTab.charAt((binarray[i >> 2] >>> ((i % 4) * 8 + 4)) & 0xF) +
        hexTab.charAt((binarray[i >> 2] >>> ((i % 4) * 8)) & 0xF);
    }
    return str;
  }
  var utf8str = utf8Encode(str);
  var x = str2binl(utf8str);
  var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (var i = 0; i < x.length; i += 16) {
    var state = [a, b, c, d];
    md5cycle(state, x.slice(i, i + 16));
    a = state[0];
    b = state[1];
    c = state[2];
    d = state[3];
  }
  return binl2hex([a, b, c, d]);
}

// web 版 hkey: Tr(path, time, nonce)
function getWebHkey(path, t, nonce) {
  var parts = path.split("/").filter(function (f) { return f; });
  var e = "/" + parts.join("/") + "/";
  var r = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";
  var o = _im(String(t), r, -2);
  var a = _om(e, r);
  var s = _om(nonce, r);
  var i = _twe([o, a, s]).slice(0, 20);
  var l = md5(i);
  var u = String(_awe(_kwe(l.slice(-6).split("").map(function (f) { return f.charCodeAt(0); }))) % 100);
  if (u.length < 2) u = "0" + u;
  var c = _im(l.substring(0, 5), r, -4);
  return c + u;
}

function genWebNonce() {
  return md5(String(Math.floor(Date.now() / 1000)) + String(Math.random())).toUpperCase();
}

// ============ 核心逻辑 ============

/**
 * 查询限免游戏列表（epic + steam 双平台）
 */
async function fetchFreeGames(account) {
  var path = "/mall/add_to_cart/";
  var allGames = [];
  var allCnt = { epic: 0, steam: 0 };

  for (var pi = 0; pi < 2; pi++) {
    var platform = pi === 0 ? "steam" : "epic";
    var t = Math.floor(Date.now() / 1000);
    var nonce = genWebNonce();
    var hkey = getWebHkey(path, t, nonce);

    var query = "app=heybox&heybox_id=" + account.heyboxId +
      "&os_type=web&x_app=heybox&x_client_type=web" +
      "&x_client_version=" + WEB_CLIENT_VERSION +
      "&x_os_type=iOS&platform=" + platform + "&is_share=false&appid=" +
      "&_time=" + t + "&hkey=" + hkey + "&nonce=" + nonce + "&version=" + WEB_VERSION;

    var resp = await httpGet(API_HOST + path + "?" + query, {
      "Cookie": account.webCookie,
      "User-Agent": WEB_UA,
      "Referer": "https://www.xiaoheihe.cn/tools/free_add",
      "Accept": "application/json"
    });
    var data = JSON.parse(resp.body);
    if (!data.result) throw new Error("接口失败: " + resp.body.slice(0, 200));
    allGames = allGames.concat(data.result.games || []).concat(data.result.free_games || []);
    if (data.result.free_game_cnt) {
      allCnt[platform] = data.result.free_game_cnt[platform] || 0;
    }
    if (pi === 0) await sleep(500);
  }
  return { games: allGames, free_game_cnt: allCnt };
}

// ============ 主流程 ============
async function main() {
  // 优先读取自动捕获的 Cookie（http-request 捕获脚本写入），插件参数兜底
  // 调试：输出 argument 原始内容（帮助排查参数传递格式）
  try { log("argument: " + (typeof $argument !== "undefined" ? $argument : "未定义")); } catch (e) {}
  var rawCookie = "";
  try {
    if (typeof $persistentStore !== "undefined") rawCookie = $persistentStore.read("xiaoheihe_cookie") || "";
  } catch (e) {}
  if (!rawCookie) rawCookie = getEnv("cookie") || getEnv("BLACKBOX_COOKIE") || "";
  if (!rawCookie) {
    log("未配置 Cookie");
    $notification.post("小黑盒限免", "", "未配置 Cookie！格式: heybox_id#pkey=xxx;x_xhh_tokenid=xxx");
    $done();
    return;
  }

  // 解析账号
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
    // web 接口需要 x_ 前缀 cookie
    var webCookie = cookie.replace(/pkey=/g, "x_pkey=").replace(/x_xhh_tokenid=/g, "x_xhh_tokenid=");
    webCookie = webCookie + ";user_heybox_id=" + heyboxId + ";user_pkey=" + webCookie.match(/x_pkey=([^;]+)/)[1];
    accounts.push({ heyboxId: heyboxId, webCookie: webCookie });
  }

  if (!accounts.length) {
    $notification.post("小黑盒限免", "", "Cookie 格式错误");
    $done();
    return;
  }

  var allLines = [];
  for (var i = 0; i < accounts.length; i++) {
    var account = accounts[i];
    try {
      var r = await fetchFreeGames(account);
      var cnt = r.free_game_cnt || {};
      // 限时免费 = 有 end_time（本周/近期限免）
      var limited = (r.games || []).filter(function (g) { return g.owned === 0 && g.end_time; });
      // Epic 限时未领取
      var epicLimited = limited.filter(function (g) { return (g.platforms || []).indexOf("epic") !== -1; });
      // Steam 限时未领取
      var steamLimited = limited.filter(function (g) { return (g.platforms || []).indexOf("steam") !== -1; });
      log("账号" + account.heyboxId + ": 限时免费 " + limited.length + " 款 (epic=" + cnt.epic + " steam=" + cnt.steam + ")");

      var lines = [];
      lines.push("🎮 限免速报 (账号" + account.heyboxId + ")");

      if (!limited.length) {
        lines.push("本周限时免费已全部领取 ✅");
      } else {
        if (epicLimited.length) {
          lines.push("");
          lines.push("🟣 Epic 限免 (点链接直接领):");
          for (var j = 0; j < epicLimited.length; j++) {
            var g = epicLimited[j];
            var end = g.end_time ? " ~" + new Date(g.end_time * 1000).toLocaleDateString("zh-CN") : "";
            lines.push("· " + g.name + end);
            if (g.namespace && g.offerId) {
              lines.push("  🔗 https://store.epicgames.com/purchase?offers=1-" + g.namespace + "-" + g.offerId);
            }
          }
        }
        if (steamLimited.length) {
          lines.push("");
          lines.push("🟦 Steam 限免 (需 App 内领取):");
          for (var k = 0; k < steamLimited.length; k++) {
            var sg = steamLimited[k];
            var end2 = sg.end_time ? " ~" + new Date(sg.end_time * 1000).toLocaleDateString("zh-CN") : "";
            lines.push("· " + sg.name + end2);
          }
        }
      }

      allLines.push(lines.join("\n"));
    } catch (e) {
      allLines.push("账号" + account.heyboxId + " 查询失败: " + e.message);
      log("账号" + account.heyboxId + " 错误: " + e.message);
    }
  }

  $notification.post("小黑盒限免速报", "", allLines.join("\n\n"));
  log("完成");
  $done();
}

main().catch(function (e) {
  log("异常: " + e.message);
  $notification.post("小黑盒限免 ⚠️", "", "脚本异常: " + e.message);
  $done();
});
