# AgentRouter 每日签到（Loon 插件）

agentrouter.org 中转站每日自动签到，登录即签到，每日领 $25 额度。

## 导入

Loon → 配置 → 插件 → 添加：

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/agentrouter/agentrouter-signin.plugin
```

## 站点机制（重要）

本站**没有独立的签到接口**，所谓签到 = 每天第一次登录：

```
POST /api/user/login  {"username":"邮箱","password":"密码"}
  → 服务端在登录时顺带发放当日额度
  → 响应 data.checked_in = true
  → 使用日志落一条 type=4 记录：
     「每日签到成功，增加额度 ＄25.000000 额度」
```

站点 FAQ 原文：「签到领＄25额度 —— **需要退出后重新登陆才会到账**」。

前端 bundle 里 `/checkin` 出现 0 次，也没有签到 UI，签到入口就是登录本身。
故本插件 = 用账号密码登录一次 + 回查 `/api/log/self` 确认日志落库。

## 备用域名（自动切换）

官方备用域名 `https://ps.air-outer.com` 与主域名功能完全一致（API + 官网）。

- 主域名**网络错误 / 被 WAF 拦截 / 返回异常**时，自动用备用域名重试
- 登录成功后记住可用域名，后续请求（含下次运行）优先使用
- 认证失败（密码错误）**不**触发切换 —— 那是凭证问题，换域名没用

## 插件参数

| 参数 | 说明 |
|---|---|
| `ACCOUNTS` | 账号。单账号 `邮箱#密码`；多账号每行一个或用分号分隔。分隔符兼容 `#` `\|` `----` |
| `RANDOM_WINDOW` | 随机时间窗口，默认 `08:00-12:00`，在此区间随机选时刻执行 |
| `FORCE` | 开关，忽略随机窗口立即签到（测试用） |
| `MANUAL_RUN` | 开关，首页手动触发时立即执行并始终推送通知（定时轮询不受影响） |
| `DEBUG` | 开关，输出详细日志 |

也支持 JSON 数组写法：

```json
[{"name":"甲","account":"a@x.com#pwdA"},{"name":"乙","account":"b@y.com#pwdB"}]
```

## 随机执行时间（防自动化判定）

Loon 的 cron **不支持随机**，所以用「轮询 + 脚本内随机闸门」实现：

```
cron "*/15 8-12 * * *"   ← 8-12 点每 15 分钟轮询一次
  ↓ 当天首次轮询：随机生成目标时刻，存入 $persistentStore
  ↓ 后续轮询：未到目标时刻 → 静默退出
  ↓ 到达目标时刻 → 执行登录签到
  ↓ 签到成功 → 记录日期，当天剩余轮询静默退出
  ↓ 12 点后仍未签到（Loon 未运行）→ 自动补跑
```

实际执行时刻 = 随机目标 + 最多 15 分钟轮询间隔，落在窗口内且带额外抖动。
窗口用 `RANDOM_WINDOW` 改，格式 `起始-结束`（24 小时制）。

## 使用

1. 装好插件后填 `ACCOUNTS`，格式 `邮箱#密码`
2. 默认 8-12 点之间随机时刻自动执行
3. 也可在 Loon 首页手动触发（通用脚本 → AgentRouter 手动签到）—— 忽略随机窗口，立即执行且始终推送通知

## 注意

- 站点有阿里云 WAF，会拦 `/api/user/self*` 路径。本插件只用了
  `/api/user/login` 和 `/api/log/self/`，实测均畅通；万一被拦会自动切备用域名。

## 注意

- **仅支持账号密码登录**。GitHub 授权注册的账号 `password` 字段为空
  （OAuth 建号走 `user := &model.User{}`，不设密码），
  且 `UpdateSelf` 在密码为空时会返回 `errUserPasswordUnset`，
  **无法自助设置密码** → 这类账号用不了本插件。
- 站点有阿里云 WAF，会拦 `/api/user/self*` 路径。本插件只用了
  `/api/user/login` 和 `/api/log/self/`，实测均畅通。
- 备用域名 `ps.air-outer.com` 功能一致，如需可改脚本里的 `BASE_URL`。

## 文件

| 文件 | 说明 |
|---|---|
| `agentrouter-signin.plugin` | 插件配置（Argument + Script） |
| `agentrouter-signin.js` | 签到脚本（纯 JS，只用 `$httpClient`/`$notification`） |
| `test/harness.js` | 本地测试垫片（真实请求） |
| `test/mock_success.js` | 4 场景 mock 测试 |

## 校验

```sh
python3 script_v2_convert.py lint agentrouter-signin.plugin
node --check agentrouter-signin.js
node test/mock_success.js agentrouter-signin.js new    # new|today|none|notchecked
node test/random_gate.js agentrouter-signin.js         # 随机时间闸门
```
