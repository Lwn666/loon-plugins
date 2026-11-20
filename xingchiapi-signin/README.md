# 🌟 星驰API 公益站签到

星驰API 公益站（https://api.xingchiapi.com）每天可领一次额度（当前 300），手机端页面没有显式签到入口，用 Loon 定时脚本领取。

## 安装

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/xingchiapi-signin/xingchiapi-signin.plugin
```

Loon → 配置 → 插件 → 添加插件，粘贴上面的地址。

## 令牌有效期

| 凭证 | 有效期 | 说明 |
|---|---|---|
| `access_token`（Bearer JWT） | **24 小时** | 接口返回 `expires_in: 86400`，实测 |
| `refresh_token`（`rt_...`） | **约 30 天** | 后端默认 `refresh_token_expire_days: 30`；站点未公开该配置，属于默认值推断 |
| 密码登录 | — | **走不通**，见下 |

`refresh_token` 是**一次性轮换**的：换一次 at 就作废旧的，同时下发新的。所以任何两份程序共用一个 rt，必然有一方被踢。

## 为什么不能改成账号密码登录

站点登录接口 `POST /api/v1/auth/login` 强制 Cloudflare Turnstile（站点 `turnstile_enabled: true`）。实测：

```
# 不带验证码
{"code":400,"message":"turnstile verification failed","reason":"TURNSTILE_VERIFICATION_FAILED"}
# 带伪造 turnstile_token，结果一样
{"code":400,"message":"turnstile verification failed","reason":"TURNSTILE_VERIFICATION_FAILED"}
```

而且后端顺序是先校验验证码、再校验密码（`auth_handler.go: Login()` 里 `VerifyCaptcha` 在 `authService.Login` 之前），所以纯 HTTP 客户端连"密码对不对"都问不到。Turnstile 需要真人浏览器环境下的挑战令牌，脚本无法生成。

顺带：用户面板接口全部走 JWT 中间件（`routes/user.go`），站点的 `sk-...` API Key 不能用来调签到。

## 两种模式

### A. 抓包模式（参数全留空，默认）

插件带一条 `http-response` 脚本，匹配 `auth/login` 与 `auth/refresh`，把浏览器会话的令牌存进 persistentStore，签到脚本直接用。

- 优点：零配置，不用管令牌
- 代价：**24 小时内要开过一次站点**，否则 access_token 过期、且没有 rt 可续（或续了会和浏览器抢）

### B. 独立会话模式（`RefreshToken` 填 rt）

把一个**独立会话**的 `rt_...` 填进参数。脚本每天用自己的 rt 续期、轮换后写回 `xingchiapi_rt_plugin`，完全不读抓包那份，浏览器会话不受影响。

- 优点：填一次约 30 天免维护，不用每天开站点
- 拿 rt 的方法：在**不常用的浏览器 / 隐私窗口 / Minis 内置浏览器**里登录一次站点，从响应里取 `refresh_token`（一次性轮换，取的这份就别再用那个窗口了，否则会互相顶掉）

两种模式的 store 键分开存：`xingchiapi_rt_capture`（抓包）与 `xingchiapi_rt_plugin`（独立会话），互不覆盖。

## 行为

- `GET /api/v1/user/checkin` 读状态，`claimed_today=true` 直接静默退出
- 未签到才 `POST /api/v1/user/checkin` 领取
- 成功推送「今日 +300 / 累计 N 天 / 余额」；失败推送 HTTP 码与响应片段
- 401 时先续期再重试；续不了才推送提醒

## 接口（实测 2026-11-20）

```
GET  /api/v1/user/checkin
  -> {"code":0,"data":{"enabled":true,"amount":300,"claimed_today":false,"today":"2026-11-20",
       "total_count":0,"total_amount":0}}

POST /api/v1/user/checkin  (body {})
  -> {"code":0,"data":{"amount":300,"new_balance":3797.04,"status":{...}}}
  重复签到 -> HTTP 409 {"code":409,"message":"already checked in today","reason":"CHECKIN_ALREADY_CLAIMED"}

POST /api/v1/auth/refresh  {"refresh_token":"rt_..."}
  -> {"code":0,"data":{"access_token":"eyJ...","refresh_token":"rt_...","token_type":"Bearer","expires_in":86400}}
```

鉴权：`Authorization: Bearer <access_token>`。站点基于 [sub2api](https://github.com/Wei-Shaw/sub2api) v0.2.21。
