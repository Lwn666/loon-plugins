# 1A2X 社区签到

[1A2X 社区](https://1a2x.com) 每日自动签到（领香蕉）。Loon 插件，凭证自动捕获，默认每天 08:00 静默签到并推送结果。

## 安装

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/1a2x-signin/1a2x-signin.plugin
```

1. Loon → 配置 → 插件 → 右上角 `+` → 粘贴上面的地址
2. 开启 MITM（插件已声明 `hostname = 1a2x.com`）
3. 用 Safari 打开一次已登录的 `https://1a2x.com`（任意页面）→ 收到「登录态已自动更新」通知
4. 完成。之后每天 08:00 自动签到；也可以在 Loon 首页 → 脚本 → `1A2X立即签到` 手动跑一次

## 接口机制（2026-11-03 实测）

站点是服务端渲染表单，没有 JSON API：

| 步骤 | 请求 | 说明 |
|---|---|---|
| 查状态 | `GET /growth` | 页面含 `<form class="daily-checkin" action="/growth/checkin">` 和 `<input type="hidden" name="_csrf">` |
| 签到 | `POST /growth/checkin` | `_csrf=<token>&return_to=/growth`，302 回 `/growth` |
| 已签判定 | 页面文案 | 「今日已签到」或签到按钮带 `disabled` |

认证是 Cookie：`__Host-nc.sid`（express-session，HttpOnly，页面 JS 读不到）+ `__Host-nc.csrf` + `nc.bid`。
所以捕获脚本从**请求头**里截完整 Cookie —— 这也是唯一能拿到 HttpOnly 会话的方式。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| 签到时间 | `0 8 * * *` | cron 表达式，默认每天 08:00 |
| 凭证自动捕获 | 开 | 浏览 1a2x.com 时自动更新 Cookie |
| 捕获时通知 | 开 | 仅凭证变化时推送 |
| 调试模式 | 关 | 输出详细日志到 Loon 控制台 |

## 凭证有效期

`__Host-nc.sid` 是 session cookie，服务端给的 Expires 约 7 天。收到「🔑 凭证已失效」通知后，
用 Safari 重新登录 1a2x.com 并浏览任意页面即可自动刷新，无需改配置。

## 验证记录

| 场景 | 方式 | 结果 |
|---|---|---|
| 无凭证 | node 仿真 Loon 运行时 | ✅ 提示「缺少登录凭证」 |
| 伪造 `__Host-nc.sid` | 真实请求 1a2x.com | ✅ `GET /growth` 返回 302 → `/login`，正确判定「凭证已失效」 |
| 真实凭证全流程 | 待填 | — |

`selftest.js` 可在 node 里仿真 Loon 运行时：

```bash
A2X_COOKIE='__Host-nc.sid=s%3A...' node selftest.js    # 真实凭证跑全流程
node selftest.js                                       # 无凭证，验证提示分支
```

## 文件

| 文件 | 作用 |
|---|---|
| `1a2x-signin.plugin` | 插件入口（Argument / Script / MITM） |
| `1a2x-capture.js` | http-request：从请求头截 Cookie，变化才写存储+通知 |
| `1a2x-signin.js` | cron/generic：查状态 → 取 CSRF → 提交 → 回读确认 |
| `selftest.js` | node 仿真桩，真实 HTTPS |

## 已知限制

- 依赖站点表单结构（`daily-checkin` / `_csrf`），改版后需同步
- 站点在 Cloudflare 后面，脚本走 `$httpClient` 直连，触发风控时返回 403/429 会明确提示
- 签到结果以「回读成长页」为准，不以 POST 的 302 为准（避免假成功）
