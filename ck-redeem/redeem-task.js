// ============================================================
// redeem-task.js — 检测 B 站 UP 主动态，提取兑换码并兑换
// 触发：cron 定时（建议 2-5 分钟一次）
// 依赖：ck-capture.js 捕获的 $persistentStore 凭证
// ============================================================
var KEY_BILI = "ck_bili_cookie";
var KEY_AUTH_ACCESS = "ck_gy_access";
var KEY_AUTH_REFRESH = "ck_gy_refresh";
var KEY_AUTH_EXPIRES = "ck_gy_expires";
var KEY_DYN_SEEN = "ck_seen_dyn_ids";
var KEY_REDEEMED = "ck_redeemed_codes";
var KEY_LAST_RUN = "ck_last_run";

var UID = "59438380"; // 一万AI分享

// ============ 纯 JS MD5 ============
var md5 = (function () {
  function safeAdd(x, y) {
    var lsw = (x & 0xffff) + (y & 0xffff);
    var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function binlMD5(x, len) {
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (var i = 0; i < x.length; i += 16) {
      var olda = a, oldb = b, oldc = c, oldd = d;
      a = md5ff(a, b, c, d, x[i], 7, -680876936);
      d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
      b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
      d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
      b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
      d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
      b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
      d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
      b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
      a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
      d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
      b = md5gg(b, c, d, a, x[i], 20, -373897302);
      a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
      d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
      b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
      d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
      b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
      d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
      b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
      a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
      d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
      b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
      d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
      b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
      d = md5hh(d, a, b, c, x[i + 0], 11, -358537222);
      c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
      b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
      d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
      b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
      a = md5ii(a, b, c, d, x[i], 6, -198630844);
      d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
      b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
      d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
      b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
      d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
      b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
      d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
      b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
      a = safeAdd(a, olda);
      b = safeAdd(b, oldb);
      c = safeAdd(c, oldc);
      d = safeAdd(d, oldd);
    }
    return [a, b, c, d];
  }
  function binl2hex(binarray) {
    var hexTab = "0123456789abcdef", str = "";
    for (var i = 0; i < binarray.length * 4; i++) {
      str += hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 0xf) +
        hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 0xf);
    }
    return str;
  }
  function str2binl(str) {
    var bin = [], mask = 255 - 255;
    mask = 0xff;
    for (var i = 0; i < str.length * 8; i += 8) {
      bin[i >> 5] |= (str.charCodeAt(i / 8) & mask) << (i % 32);
    }
    return bin;
  }
  return function (s) { return binl2hex(binlMD5(str2binl(s), s.length * 8)); };
})();

// ============ 工具 ============
function log(msg) { console.log("[兑换任务] " + msg); }

function readStore(key) {
  try { return $persistentStore.read(key) || ""; } catch (e) { return ""; }
}
function writeStore(key, val) {
  try { $persistentStore.write(val, key); return true; } catch (e) { return false; }
}

function httpGet(url, headers) {
  return new Promise(function (resolve) {
    $httpClient.get({ url: url, headers: headers || {}, timeout: 15000, node: "DIRECT", "auto-cookie": false }, function (err, resp, data) {
      resolve({ err: err, status: resp ? resp.status : 0, body: typeof data === "string" ? data : String(data || "") });
    });
  });
}
function httpPost(url, headers, body) {
  return new Promise(function (resolve) {
    $httpClient.post({ url: url, headers: headers || {}, body: body || "", timeout: 15000, node: "DIRECT", "auto-cookie": false }, function (err, resp, data) {
      resolve({ err: err, status: resp ? resp.status : 0, body: typeof data === "string" ? data : String(data || "") });
    });
  });
}

function getCookieItem(cookie, name) {
  if (!cookie) return "";
  var m = String(cookie).match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : "";
}

function splitList(s) {
  if (!s) return [];
  return String(s).split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}

// ============ B 站 wbi 签名 ============
var MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

function getMixinKey(imgKey, subKey) {
  var raw = imgKey + subKey;
  var out = "";
  for (var i = 0; i < 32; i++) out += raw[MIXIN_KEY_ENC_TAB[i]];
  return out;
}

function signParams(params, imgKey, subKey) {
  var mixinKey = getMixinKey(imgKey, subKey);
  params["wts"] = Math.floor(Date.now() / 1000);
  var keys = Object.keys(params).sort();
  var query = "";
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = String(params[k]).replace(/[!'()*]/g, "");
    query += (i > 0 ? "&" : "") + encodeURIComponent(k) + "=" + encodeURIComponent(v);
  }
  params["w_rid"] = md5(query + mixinKey);
  return params;
}

function getWbiKeys() {
  return new Promise(function (resolve) {
    // 优先从 BiliBiliDailyBonus 存储的 user.wbi_img 直接取（省一次 nav 请求）
    try {
      var raw = $persistentStore.read("bilibili_daily_bonus") || "";
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.user && obj.user.wbi_img && obj.user.wbi_img.img_url) {
          var img = obj.user.wbi_img.img_url.split("/").pop().split(".")[0];
          var sub = obj.user.wbi_img.sub_url.split("/").pop().split(".")[0];
          if (img && sub) { resolve([img, sub]); return; }
        }
      }
    } catch (e) {}
    // fallback：请求 nav 接口
    httpGet("https://api.bilibili.com/x/web-interface/nav", { "User-Agent": UA() }).then(function (r) {
      try {
        var j = JSON.parse(r.body);
        if (!j.data || !j.data.wbi_img || !j.data.wbi_img.img_url) { resolve(null); return; }
        var img = j.data.wbi_img.img_url.split("/").pop().split(".")[0];
        var sub = j.data.wbi_img.sub_url.split("/").pop().split(".")[0];
        resolve([img, sub]);
      } catch (e) { resolve(null); }
    });
  });
}

function UA() {
  // B 站 App UA，比浏览器 UA 更不易被 wbi 风控（与 BiliBiliDailyBonus 一致）
  return "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4_1 like Mac OS X) AppleWebKit/621.1.15.10.7 (KHTML, like Gecko) Mobile/22E252 BiliApp/84400100 os/ios mobi_app/iphone build/84400100 channel/AppStore c_locale/zh-Hans_CN s_locale/zh-Hans_CN disable_rcmd/0";
}

function getBuvid() {
  return new Promise(function (resolve) {
    httpGet("https://api.bilibili.com/x/frontend/finger/spi", { "User-Agent": UA() }).then(function (r) {
      try {
        var j = JSON.parse(r.body);
        if (j.code === 0 && j.data) {
          log("buvid 获取成功");
          resolve({ buvid3: j.data.b_3, buvid4: j.data.b_4 });
          return;
        }
      } catch (e) { log("spi 接口异常: " + r.body.slice(0, 60).replace(/\n/g, " ")); }
      // fallback：生成随机 buvid3/buvid4（格式正确即可）
      var rand = function () {
        var s = ""; for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16).toUpperCase();
        return s;
      };
      var b3 = rand() + "-" + rand().slice(0, 4) + "-" + rand().slice(0, 4) + "-" + rand().slice(0, 4) + "-" + rand() + rand().slice(0, 8) + "infoc";
      var b4 = rand() + "-" + rand().slice(0, 4) + "-" + rand().slice(0, 4) + "-" + rand().slice(0, 4) + "-" + rand() + "-" + rand() + "-" + rand();
      log("buvid spi 失败，用随机值: b3=" + b3.slice(0, 20) + "...");
      resolve({ buvid3: b3, buvid4: b4 });
    });
  });
}

// 抓取 UP 主最新动态（最多 20 条）
function getBiliCookie() {
  // 优先读 BiliBiliDailyBonus 插件维护的 ck（扫码方式，用户本机已有）
  try {
    var raw = $persistentStore.read("bilibili_daily_bonus") || "";
    if (raw) {
      var obj = JSON.parse(raw);
      if (obj && obj.cookieStr) return obj.cookieStr;
      if (obj && obj.cookie) {
        var parts = [];
        for (var k in obj.cookie) {
          if (obj.cookie[k]) parts.push(k + "=" + obj.cookie[k]);
        }
        if (parts.length) return parts.join("; ");
      }
    }
  } catch (e) { log("读 bilibili_daily_bonus 失败: " + e); }
  // 兜底：自己捕获的 ck
  return readStore(KEY_BILI);
}

function fetchDynamics() {
  return new Promise(function (resolve) {
    var biliCk = getBiliCookie();
    log("B站ck: " + (biliCk ? "已获取(len=" + biliCk.length + ")" : "无(匿名模式)"));
    getBuvid().then(function (buvid) {
      getWbiKeys().then(function (keys) {
        var attempt = function (retry) {
          var params = {
            host_mid: UID,
            timezone_offset: "-480",
            platform: "web",
            features: "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard",
            page: 1,
            web_location: "333.999"
          };
          if (keys) params = signParams(params, keys[0], keys[1]);
          var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
          var url = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?" + qs;
          var headers = { "User-Agent": UA(), "Referer": "https://space.bilibili.com/" + UID + "/dynamic", "Origin": "https://space.bilibili.com", "Accept": "application/json, text/plain, */*" };
          if (buvid.buvid3) headers["Cookie"] = "buvid3=" + buvid.buvid3 + "; buvid4=" + buvid.buvid4 + (biliCk ? "; " + biliCk : "");
          log("wbi签名: w_rid=" + params.w_rid + " wts=" + params.wts + " keys=" + (keys ? keys[0].slice(0, 8) + "/" + keys[1].slice(0, 8) : "null"));
          httpGet(url, headers).then(function (r) {
            try {
              var j = JSON.parse(r.body);
              if (j.code !== 0) {
                log("动态API code=" + j.code + " msg=" + (j.message || ""));
                if (retry < 2) { log("重试 " + (retry + 1) + "..."); setTimeout(function () { attempt(retry + 1); }, 2000); return; }
                resolve([]); return;
              }
              var items = j.data.items || [];
              var out = [];
              for (var i = 0; i < items.length; i++) {
                var it = items[i];
                var md = (it.modules && it.modules.module_dynamic) || {};
                var txt = (md.desc && md.desc.text) || "";
                if (!txt && md.major && md.major.opus && md.major.opus.summary) txt = md.major.opus.summary.text || "";
                var ts = (it.modules && it.modules.module_author && it.modules.module_author.pub_ts) || 0;
                out.push({ id: it.id_str, ts: ts, text: txt });
              }
              log("获取动态成功: " + out.length + " 条");
              resolve(out);
            } catch (e) {
              log("解析动态失败: " + e + " | 响应前80字: " + r.body.slice(0, 80).replace(/\n/g, " "));
              if (retry < 2) { log("重试 " + (retry + 1) + "..."); setTimeout(function () { attempt(retry + 1); }, 2000); return; }
              resolve([]);
            }
          });
        };
        attempt(0);
      });
    });
  });
}

// ============ 公益站 API ============
function ensureAccessToken() {
  return new Promise(function (resolve) {
    var access = readStore(KEY_AUTH_ACCESS);
    var expires = parseInt(readStore(KEY_AUTH_EXPIRES), 10) || 0;
    var rt = readStore(KEY_AUTH_REFRESH);
    // access 未过期直接用
    if (access && expires && expires > Date.now() + 60000) { resolve(access); return; }
    if (!rt) { log("无 refresh_token，跳过兑换"); resolve(null); return; }
    // 用 refresh_token 换新 access
    httpPost("https://api.910501.xyz/api/v1/auth/refresh",
      { "Content-Type": "application/json", "User-Agent": UA() },
      JSON.stringify({ refresh_token: rt })).then(function (r) {
      try {
        var j = JSON.parse(r.body);
        if (j.code === 0 && j.data && j.data.access_token) {
          writeStore(KEY_AUTH_ACCESS, j.data.access_token);
          if (j.data.refresh_token) writeStore(KEY_AUTH_REFRESH, j.data.refresh_token);
          writeStore(KEY_AUTH_EXPIRES, String(Date.now() + (j.data.expires_in || 86400) * 1000));
          resolve(j.data.access_token);
        } else {
          log("refresh 失败: " + r.body.slice(0, 200));
          resolve(null);
        }
      } catch (e) { log("refresh 解析失败: " + e); resolve(null); }
    });
  });
}

function doRedeem(code, token) {
  return new Promise(function (resolve) {
    httpPost("https://api.910501.xyz/api/v1/redeem",
      { "Content-Type": "application/json", "Authorization": "Bearer " + token, "User-Agent": UA() },
      JSON.stringify({ code: code })).then(function (r) {
      try {
        var j = JSON.parse(r.body);
        resolve({ code: j.code, message: j.message || "", reason: j.reason || "" });
      } catch (e) { resolve({ code: -1, message: "解析失败: " + r.body.slice(0, 100), reason: "" }); }
    });
  });
}

// ============ 主流程 ============
function main() {
  var lastRun = readStore(KEY_LAST_RUN);
  var now = Date.now();
  log("==== 开始检测 (上次: " + (lastRun ? new Date(parseInt(lastRun, 10)).toLocaleString() : "首次") + ") ====");

  fetchDynamics().then(function (items) {
    if (!items.length) { log("未获取到动态"); finish(); return; }

    var seenIds = splitList(readStore(KEY_DYN_SEEN));
    var redeemed = splitList(readStore(KEY_REDEEMED));

    log("最新动态: id=" + items[0].id + " ts=" + items[0].ts);
    log("内容: " + items[0].text.slice(0, 100).replace(/\n/g, " "));

    // 遍历所有动态，找第一条含「兑换码：」且未兑换过的
    var codeItem = null, code = "";
    for (var i = 0; i < items.length; i++) {
      var m = items[i].text.match(/兑换码[:：]\s*([A-Za-z0-9_-]{4,32})/);
      if (m) {
        if (redeemed.indexOf(m[1]) === -1) { codeItem = items[i]; code = m[1]; break; }
        else { log("动态 " + items[i].id + " 的码 " + m[1] + " 已兑换过，跳过"); }
      }
    }

    if (!code) {
      log("最新动态无未兑换的兑换码，跳过");
      // 记录已看过的最新 id
      if (seenIds.indexOf(items[0].id) === -1) {
        seenIds.unshift(items[0].id);
        writeStore(KEY_DYN_SEEN, seenIds.slice(0, 50).join(","));
      }
      finish();
      return;
    }
    log("发现兑换码: " + code + " (来自动态 " + codeItem.id + ")");

    // 去重：已兑换过直接跳过
    if (redeemed.indexOf(code) !== -1) {
      log("该码已兑换过，跳过");
      finish();
      return;
    }

    // 兑换
    ensureAccessToken().then(function (token) {
      if (!token) {
        log("❌ 无有效 token，无法兑换 " + code);
        $notification.post("兑换失败", "无有效公益站登录态", "兑换码 " + code + " 未兑换。请打开公益站任意页面刷新登录态。");
        finish();
        return;
      }
      doRedeem(code, token).then(function (res) {
        if (res.code === 0) {
          redeemed.unshift(code);
          writeStore(KEY_REDEEMED, redeemed.slice(0, 50).join(","));
          log("✅ 兑换成功: " + code);
          $notification.post("🎉 兑换成功", "兑换码 " + code, "已成功兑换到账号");
        } else if (res.code === 409) {
          // 已被别人用了
          redeemed.unshift(code);
          writeStore(KEY_REDEEMED, redeemed.slice(0, 50).join(","));
          log("⚠️ 兑换码已被使用: " + code + " (" + res.message + ")");
          $notification.post("⚠️ 来晚了", "兑换码 " + code, "已被他人使用: " + res.message);
        } else {
          log("❌ 兑换失败: " + code + " -> " + res.message);
          $notification.post("兑换失败", "兑换码 " + code, res.message || "未知错误");
        }
        finish();
      });
    });
  });
}

function finish() {
  writeStore(KEY_LAST_RUN, String(Date.now()));
  $done();
}

try { main(); } catch (e) {
  console.log("[兑换任务] 异常: " + e + " | " + (e.stack || ""));
  $done();
}
