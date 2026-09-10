/**
 * 小黑盒 Cookie 自动捕获脚本
 * 
 * 原理：匹配 api.xiaoheihe.cn 请求，自动提取 heybox_id + pkey + x_xhh_tokenid
 * 存入 persistentStore（key: xiaoheihe_cookie），主脚本优先读取。
 * 
 * 触发：打开小黑盒 App 任意页面（会自动发 api.xiaoheihe.cn 请求）
 * 存储格式: heybox_id#pkey=xxx;x_xhh_tokenid=xxx（多账号 & 分隔，自动去重）
 */

var COOKIE_KEY = "xiaoheihe_cookie";

function getCookieItem(cookie, name) {
  // 精确匹配 pkey（不匹配 x_pkey）
  var re = new RegExp("(?:^|;\\s*)" + name + "=([^;]+)", "i");
  var m = String(cookie || "").match(re);
  return m ? m[1] : "";
}

function main() {
  var url = $request.url || "";
  // 只处理 api.xiaoheihe.cn 的请求
  if (url.indexOf("api.xiaoheihe.cn") === -1) {
    $done({});
    return;
  }

  var headers = $request.headers || {};
  var cookie = headers["Cookie"] || headers["cookie"] || "";
  var m = url.match(/[?&]heybox_id=(\d+)/);
  var heyboxId = m ? m[1] : "";
  var pkey = getCookieItem(cookie, "pkey");
  var token = getCookieItem(cookie, "x_xhh_tokenid");

  // 非 iOS 登录请求（如 web 版 add_to_cart 只有 x_pkey，无普通 pkey）跳过
  if (!heyboxId || !pkey || !token) {
    $done({});
    return;
  }

  var newAcct = heyboxId + "#pkey=" + pkey + ";x_xhh_tokenid=" + token;

  // 读取已保存，去重合并（同 heyboxId 用最新值）
  var saved = "";
  try { saved = $persistentStore.read(COOKIE_KEY) || ""; } catch (e) {}
  var list = String(saved).split(/[&\n]/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  var filtered = list.filter(function (s) { return s.split("#")[0] !== heyboxId; });
  filtered.unshift(newAcct);
  var next = filtered.join("&");

  // 仅在 cookie 变化时写入 + 通知（避免每次请求都弹通知）
  if (next !== saved) {
    try { $persistentStore.write(next, COOKIE_KEY); } catch (e) {}
    console.log("[小黑盒] Cookie 已自动更新: 账号 " + heyboxId);
    try {
      $notification.post("小黑盒", "Cookie 已自动获取 ✓", "账号 " + heyboxId + "\n后续签到/限免将自动使用此 Cookie");
    } catch (e) {}
  }
  $done({});
}

try {
  main();
} catch (e) {
  console.log("[小黑盒] 捕获异常: " + (e && e.message));
  $done({});
}
