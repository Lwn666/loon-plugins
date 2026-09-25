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
| cf_clearance | 可选。仅当被 CF 挑战拦截时填，需与「自定义 UA」配套，两者必须来自同一个浏览器 |
| 自定义 UA | 可选。`cf_clearance` 绑定 UA，换 UA 立刻 403 |
| 执行时间 | 默认 `0 8 * * *`（每天 08:00），可自行更改 |
| 手动触发立即执行 | 首页点「THTV 手动签到」时立即执行 |
| 调试模式 | 输出详细日志，排查用 |

> 也可以只填邮箱（不填密码）：这样只用本地缓存的 cookie 签到，cookie 失效时会通知你去 App 里重新登录一次。

## 工作原理

```
启动
 ├─ 有缓存 cookie ──→ POST /api/sign-in
 │                      ├─ 被 CF 挑战拦下 ──→ 重试 1 次 → 🚧「CF拦截」（不换票）
 │                      ├─ 有 currentExp/level ─→ ✅「签到成功 · 经验 x · Lv n」
 │                      ├─ success:true ────→ ✅ 通知「签到成功」
 │                      ├─ 已到过 ──────────→ ℹ️ 通知「今日已签」
 │                      └─ 请先登录 ────────→ 自动登录换票 → 重试一次
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

### 签到接口的两种响应形态（真机实测）

```jsonc
// 首次签到成功 —— 注意：没有 success 字段！
{ "currentExp": 3525, "level": { "minExp": 3000, "level": 9, "nextLevel": 6000 } }

// 今日已签
{ "success": false, "message": "今天已经签到过了" }
```

## ⚠️ 2026-09-25：站点上了 Cloudflare 托管挑战

站点当前对所有请求（含 `/login` 与 `/api/*`）下发 **Cloudflare 托管挑战**：

```
HTTP 403 · cf-mitigated: challenge · title "Just a moment..."
cType: 'managed' (cZone: satomi.cc)
```

排查证据：

| 客户端 | 结果 |
|---|---|
| curl（本机 / NAS 直连 / NAS 走代理，任意 UA） | 全部 403 挑战页 |
| 真机 WebKit 浏览器 | 先挑战，**约 12 秒后自动通过** |
| 浏览器过挑战后，同页面内的 `fetch` 子请求 | ✅ 200（`/api/media-post/check-permissions` 返回 JSON） |
| curl + 新鲜 `cf_clearance` + **与之一致的 UA** | ✅ 大概率 200（同条件下会概率性 403） |
| curl + `cf_clearance` 但**换了 UA** | ❌ 403（`cf_clearance` 绑定 UA） |

**这不是插件 bug，也不会靠改插件绕过去。** 受此影响的处置：

1. 脚本被拦时会收到 `🚧 CF拦截` 通知（而不再谎报「换票失败 HTTP 403」）
2. 用浏览器打开一次 satomi.cc，等挑战自动通过（约 10-20 秒）后重试
3. 若站点长期开启挑战：把浏览器里的 `cf_clearance` 与配套 UA 填进插件参数

## 注意事项

- **凭证只存在手机端** `$persistentStore`（key 形如 `thtv_login_token_<邮箱>`），不会上传到任何地方。
- 密码是明文存在 Loon 本地配置里。介意的话就别填密码，改用「只填邮箱」模式。
- 脚本已做兼容：Loon 有时把响应体当字节数组返回，脚本会正确还原 UTF-8（否则通知里会是一串数字）。
- 网络请求超时 20 秒，且**失败自动重试 1 次**：设备到 satomi.cc 的链路抖动很大（实测同一请求 0.6s ~ 17.7s），单次超时不代表没网。

## 踩坑记录

### 1. `$httpClient` 的 timeout 单位是毫秒

`$httpClient` 的 `options.timeout` 单位是**毫秒**（Loon 官方文档：默认 5000，单位为毫秒）。

本插件曾把它当成秒，写了 `timeout: 20` → 请求发出 20 毫秒就被判超时，真机报：

```
网络错误：HTTPClient request failed with error:Error Domain=LNHTTPClientDomain Code=1 "Request timeout."
```

更能骗人的是配套测试垫片：`timeout: (o.timeout || 20) * 1000` 把 20 当成 20 秒，
于是**本地测试全绿、真机必挂**。教训：垫片的语义必须与真机逐字对齐，否则测的只是垫片自己的假设。

### 2. 把 Cloudflare 的 403 当成「凭证失效」（2026-09-25 修）

旧版看到 403 就判定 cookie 失效 → 触发自动换票 → 登录接口同样被挑战拦下 →
最终报「换票失败：登录失败 HTTP 403 + 挑战页 HTML」，**把排查方向带偏到账号密码上**。

现在先做挑战识别（响应头 `cf-mitigated: challenge` 或响应体含 `Just a moment` / `challenges.cloudflare.com`），
命中则重试 1 次后如实上报，**绝不触发换票**（换票只会多一次注定失败的请求）。

### 3. 签到成功的响应没有 `success` 字段

旧版只认 `d.success === true`，于是**真机签到成功会被报成「⚠️ 提示」**。
现按 `currentExp` / `level` 字段特征判成功，并把经验值与等级显示在通知里。

## 验证记录

`selftest.js` 在 node 里仿真 Loon 运行时（`$httpClient` 故意回传字节数组以复现真机行为；
CF 挑战与各类 JSON 响应可注入，用例 ①②⑤⑥⑦ 已改为确定性 mock，不再受站点 CF 状态影响）：

| # | 场景 | 期望 |
|---|---|---|
| ① | `TIMEOUT=20`（毫秒） | 复现真机症状：`Request timeout.` |
| ② | 登录被拒（mock） | 如实回传服务器原话 `邮箱或密码错误` |
| ③ | 未配置账号 | `⚠️ 未配置账号` |
| ④ | 无缓存 cookie 且未提供密码 | `❌ 无缓存 cookie 且未提供密码` |
| ⑤ | 有(未登录) cookie + 未配密码（mock） | `🔑 需要登录` |
| ⑥ | 有(未登录) cookie + 错误密码（mock） | 触发自动换票 → `换票失败：邮箱或密码错误` |
| ⑦ | 首次请求超时（故障注入 + mock） | 自动重试后拿到服务器原话 |
| ⑧ | 一直超时（故障注入） | 只重试 1 次，如实报错，不无限重试 |
| ⑨ | **CF 托管挑战（注入）** | `🚧 CF拦截`，且**登录接口 0 次调用**、签到重试 1 次 |
| ⑩ | **成功响应无 success 字段（真机实测形态）** | `✅ 成功 · 经验 3525 · Lv9` |
| ⑪ | 今日已签响应 | `ℹ️ 今日已签：今天已经签到过了` |
| ⑫ | 真机冒烟（真发请求） | 必须落在「🔑 需要登录」或「🚧 CF拦截」二者之一 |

本地复现：`node selftest.js`（约 11s）
