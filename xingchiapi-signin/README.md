# 🌟 星驰API 公益站签到

星驰API 公益站（https://api.xingchiapi.com）每天可领一次额度（当前 300），手机端页面没有显式签到入口，用 Loon 定时脚本领取。

## 安装

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/xingchiapi-signin/xingchiapi-signin.plugin
```

Loon → 配置 → 插件 → 添加插件，粘贴上面的地址。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| 执行时间 | `5 8 * * *` | 每天 08:05，可改 |
| 访问令牌（可选） | 空 | **留空即可**。插件会在你登录/刷新站点时自动抓取 |
| 刷新令牌（可选） | 空 | `rt_...` 开头；填了可在访问令牌过期后自动续期 |

只需添加插件、什么都不填就能用——前提是手机开着 Loon 且 **24 小时内打开过一次站点**（Loon 里需要允许 MITM 与证书）。

## 行为

- `GET /api/v1/user/checkin` 读状态：`claimed_today=true` 直接静默退出，不重复推送
- 未签到才 `POST /api/v1/user/checkin` 领取
- 成功推送「今日 +300 / 累计 N 天 / 余额」；失败推送 HTTP 码与响应片段
- 401 时：有刷新令牌先续期再重试，没有则推送提醒重新登录

## 令牌怎么来（自动）

插件带一条 `http-response` 脚本，匹配 `api.xingchiapi.com/api/v1/auth/login` 与 `.../auth/refresh`，把响应里的 `access_token` / `refresh_token` 存进 Loon 的 persistentStore。签到脚本优先用这份令牌，所以不会和浏览器抢刷新令牌。

需要满足：Loon 已装证书 + 配置里对 `api.xingchiapi.com` 开启 MITM（插件里的 `[MITM]` 段会自动追加）。

## 关于刷新令牌的注意

站点的 refresh token 是**一次性轮换**的（用一次旧的就作废，`POST /api/v1/auth/refresh` 会返回新的 `rt_...`）。脚本续期后会把新令牌写回 store，但浏览器手里那份同时失效，需要重新登录一次。

所以：**除非确实长时间不开站点，不建议填刷新令牌**，靠自动抓取更省心。

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

鉴权：`Authorization: Bearer <access_token>`，JWT 有效期 24 小时。站点基于 [sub2api](https://github.com/Wei-Shaw/sub2api)（版本 0.2.21）。
