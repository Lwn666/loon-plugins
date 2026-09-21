# THTV 每日签到（Loon 插件）

探花社区 [satomi.cc](https://satomi.cc) 每日自动签到。cookie 失效时自动用账号密码重新登录换票，**无需手动更新凭证**。

## 安装

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/thtv-signin/thtv-signin.plugin
```

Loon → 配置 → 插件 → 右上角 `+` → 粘贴上面的链接 → 安装。

## 参数

| 参数 | 说明 |
|---|---|
| **账号** | 格式 `邮箱#密码`，多账号每行一个（也支持分号分隔） |
| 执行时间 | 默认 `0 8 * * *`（每天 08:00），可自行更改 |
| 手动触发立即执行 | 首页点「THTV 手动签到」时立即执行 |
| 调试模式 | 输出详细日志，排查用 |

> 也可以只填邮箱（不填密码）：这样只用本地缓存的 cookie 签到，cookie 失效时会通知你去 App 里重新登录一次。

## 工作原理

```
启动
 ├─ 有缓存 cookie ──→ POST /api/sign-in
 │                      ├─ success:true ──→ ✅ 通知「签到成功」
 │                      ├─ 已到过 ────────→ ℹ️ 通知「今日已签」
 │                      └─ 请先登录 ──────→ 自动登录换票 → 重试一次
 └─ 无缓存 cookie ──→ 先登录拿票 → 再签到
```

接口（从站点前端 `/static/js/login.js` 与真机抓包核实）：

| 用途 | 请求 |
|---|---|
| 登录 | `POST https://satomi.cc/login`，body `{"email":"...","password":"...","rememberMe":true}` |
| 签到 | `POST https://satomi.cc/api/sign-in`，body `{}`，仅靠 cookie 鉴权 |

登录成功后服务端下发两个 cookie：
- `loginToken=UID<数字>_<32位hex>` — 身份标识，`rememberMe` 决定是否下发
- `SESSION=<base64>` — 会话，`Max-Age=2592000`（30 天）

服务端在响应里续发的 `Set-Cookie` 会被自动跟随并写回本地。

## 注意事项

- **凭证只存在手机端** `$persistentStore`（key 形如 `thtv_login_token_<邮箱>`），不会上传到任何地方。
- 密码是明文存在 Loon 本地配置里。介意的话就别填密码，改用「只填邮箱」模式。
- 脚本已做兼容：Loon 有时把响应体当字节数组返回，脚本会正确还原 UTF-8（否则通知里会是一串数字）。
- 网络请求超时 20 秒，且**失败自动重试 1 次**：设备到 satomi.cc 的链路抖动很大（实测同一请求 0.6s ~ 17.7s），单次超时不代表没网。

## 踩坑记录：`$httpClient` 的 timeout 单位是毫秒

`$httpClient` 的 `options.timeout` 单位是**毫秒**（Loon 官方文档：默认 5000，单位为毫秒）。

本插件曾把它当成秒，写了 `timeout: 20` → 请求发出 20 毫秒就被判超时，真机报：

```
网络错误：HTTPClient request failed with error:Error Domain=LNHTTPClientDomain Code=1 "Request timeout."
```

更能骗人的是配套测试垫片：`timeout: (o.timeout || 20) * 1000` 把 20 当成 20 秒，
于是**本地测试全绿、真机必挂**。教训：垫片的语义必须与真机逐字对齐，否则测的只是垫片自己的假设。

## 验证记录

`selftest.js` 在 node 里仿真 Loon 运行时（真发请求到 satomi.cc，且 `$httpClient` 故意回传字节数组以复现真机行为）：

| # | 场景 | 期望 |
|---|---|---|
| ① | `TIMEOUT=20`（毫秒） | 复现真机症状：`Request timeout.` |
| ② | 用脚本实际 TIMEOUT | 拿到服务器原话 `邮箱或密码错误`（证明登录链路真的通） |
| ③ | 未配置账号 | `⚠️ 未配置账号` |
| ④ | 无缓存 cookie 且未提供密码 | `❌ 无缓存 cookie 且未提供密码` |
| ⑤ | 有(未登录) cookie + 未配密码 | `🔑 需要登录` |
| ⑥ | 有(未登录) cookie + 错误密码 | 触发自动换票 → `换票失败：邮箱或密码错误` |
| ⑦ | 首次请求超时（故障注入） | 自动重试后成功 |
| ⑧ | 一直超时（故障注入） | 只重试 1 次，如实报错，不无限重试 |

本地复现：`node selftest.js`（需联网，约 30s）

> 未覆盖：真实账号密码的换票成功分支——需要真凭证，未在本仓库的测试中执行。

