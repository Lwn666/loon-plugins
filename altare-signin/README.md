# ⚡ Altare 每日签到

Altare 团队每天可领一次每日奖励（基础 13.33 bolts，连签 +0.67/天，上限 10 天）。手机端控制台导航里没有签到入口，所以用 Loon 定时脚本领取。

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
| 团队ID | 默认已填 `01a47a1e-cb7a-44d8-87e5-a06be4f315be`（team Default） |
| 会话令牌 | **必填**。在 iSH 执行 `altr token` 取得，粘贴即可 |

令牌是账号级凭证，**只存在你本机的插件参数里**，不要提交到仓库、不要发到群里。失效（401）时重新 `altr token` 覆盖一次。

## 行为

- 每天定时读一次签到状态：`GET /api/tenants/{team}/rewards`
- `canClaim=true` 才领取：`POST /api/tenants/{team}/rewards/claim`
- **已领过则静默**，不重复推送
- 领取成功推送「+X bolts / 连签天数 / 余额」；失败推送错误码与响应片段

## 注意

- 领取要求账号已绑定 Discord（未绑定接口返回 `403 ECONOMY_LOCKED`）
- 每天一次按 UTC 日计算，北京时间 08:00 之后是新的一天
- 该接口是控制台内部 API，官方文档未公开；接口若变更，脚本需要跟着改
