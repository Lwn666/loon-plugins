/*
 * 星驰API 令牌捕获（Loon http-response）
 * 用户在浏览器/App 登录或刷新站点时，把 access_token / refresh_token 存进 persistentStore。
 *
 * 注意：这里抓到的 refresh_token 属于「浏览器会话」，是一次性轮换的。
 * 签到脚本只在「参数里没填 RefreshToken」的 capture 模式下才会用它；
 * 填了参数（manual 模式）时脚本只用自己续期出来的 rt，不会动浏览器这份。
 */

var K_AT = "xingchiapi_at";
var K_RT_CAPTURE = "xingchiapi_rt_capture";

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
      if (d.refresh_token) { save(K_RT_CAPTURE, d.refresh_token); }
      console.log("[xingchi] 已捕获令牌 at_len=" + String(d.access_token).length + " rt=" + (d.refresh_token ? "yes" : "no"));
    }
  }
} catch (e) {
  console.log("[xingchi] 解析响应失败: " + e);
}

$done({});
