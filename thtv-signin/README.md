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

## 验证记录

用 Loon API 仿真器（`test/harness.cjs`，真发请求到 satomi.cc）跑通 5 条分支：

| 场景 | 结果 |
|---|---|
| 有效 cookie | `ℹ️ 今日已签: 今天已经签到过了` |
| 坏 cookie + 未配密码 | `🔑 需要登录: 请先登录` |
| 坏 cookie + 错误密码 | `❌ 失败: 换票失败：邮箱或密码错误`（证明登录链路真的打通） |
| 有效 cookie + 已配密码 | 直接签到，不浪费一次登录 |
| 未配置账号 | `⚠️ 未配置账号` 并给出格式提示 |

本地复现：`node test/run.js`
