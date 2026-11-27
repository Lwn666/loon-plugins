# ⚡ Altare 每日签到

Altare 团队每天可领一次每日奖励（基础 13.33 bolts，连签 +0.67/天，上限 10 天）。手机端控制台导航里没有签到入口，所以用 Loon 定时脚本领取。

**v2：支持两个账号**（各自的令牌与团队 ID），一次运行依次处理，最后合并成一条推送。

## 安装

插件地址：

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/altare-signin/altare-signin.plugin
```

Loon → 配置 → 插件 → 添加插件，粘贴上面的地址。

## 参数

| 参数 | 说明 |
|---|---|
| 执行时间 | 默认 `5 8 * * *`（每天 08:05），可改 |
| 账号1-团队ID | 默认已填 `01a47a1e-cb7a-44d8-87e5-a06be4f315be`（team Default） |
| 账号1-会话令牌 | **必填**。在已登录该账号的机器上执行 `altr token` 取得 |
| 账号2-团队ID | 第二个账号的团队 ID；**留空则沿用账号1的** |
| 账号2-会话令牌 | 第二个账号的 `altr token`；**留空则不启用账号2** |

令牌是账号级凭证，**只存在你本机的插件参数里**，不要提交到仓库、不要发到群里。失效（401）时重新 `altr token` 覆盖一次。

第二个账号的团队 ID 怎么拿：在该账号登录的环境执行

```bash
altr server info <任意服务器名> --json | grep tenantId
```

## 行为

- 依次处理每个已配置账号：`GET /api/tenants/{team}/rewards` 查 `canClaim`
- 只有 `canClaim=true` 才 `POST /api/tenants/{team}/rewards/claim`
- **全部账号今日已领 → 静默**，不重复推送
- 有领取成功或失败 → 合并成**一条**推送，逐行列出各账号结果
- 一个账号失败不影响另一个账号

推送样例：

```
Altare 签到成功
2 个账号 +38.72 bolts
账号1 ✅ +19.36 bolts｜连签 10 天｜余额 231.84
账号2 ✅ +19.36 bolts｜连签 10 天｜余额 231.84
```

## 注意

- 领取要求账号已绑定 Discord（未绑定接口返回 `403 ECONOMY_LOCKED`）
- 每天一次按 UTC 日计算，北京时间 08:00 之后是新的一天
- 该接口是控制台内部 API，官方文档未公开；接口若变更，脚本需要跟着改
- 自测：`node mock-test.js`（9 个用例，模拟 Loon 环境，不联网）
