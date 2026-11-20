/*
 * 星驰API 令牌捕获（Loon http-response）
 * 用户在浏览器/App 登录或刷新站点时，把 access_token / refresh_token 存入 persistentStore，
 * 供 xingchiapi-signin.js 使用。这样签到脚本不需要自己去换发令牌，
 * 不会和浏览器抢 refresh token（站点的 rt 是一次性轮换的）。
 */

var K_AT = "xingchiapi_at";
var K_RT = "xingchiapi_rt";

function save(key, val) {
  if (!val || typeof val !== "string") { return; }
  try { $persistentStore.write(val, key); } catch (e) { console.log("[xingchi] store 写入失败 " + key); }
}

try {
  var body = $response.body;
  if (body) {
    var j = JSON.parse(body);
    var d = (j && j.data) ? j.data : j;
    if (d && d.access_token) {
      save(K_AT, d.access_token);
      if (d.refresh_token) { save(K_RT, d.refresh_token); }
      console.log("[xingchi] 已捕获令牌 at_len=" + String(d.access_token).length + " rt=" + (d.refresh_token ? "yes" : "no"));
    }
  }
} catch (e) {
  console.log("[xingchi] 解析响应失败: " + e);
}

$done({});
