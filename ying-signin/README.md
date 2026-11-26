# Ying 签到 + 积分会员续期（Loon JS）

主页：`https://ying.wedg.top/account`。
本目录仅含纯 Loon 生产脚本、插件声明及离线 mock 测试；公开文件没有真实账号、密码、Cookie。

## 文件与安装

- `ying-signin.js`：生产代码，只用 Loon `$httpClient`、`$persistentStore`、`$notification`、`$done`，不需要 MITM、凭证捕获、Node、DOM 或第三方服务。
- `ying-signin.plugin`：Script v2，generic 手动入口 + cron；两者均传对象参数，脚本时限 180 秒。需要 Loon 3.5.1(983)+。
- `test.js`：Node 内置 `vm` 执行磁盘上的真实 `ying-signin.js`，mock 全部 HTTP 和持久化，无真实网络、无凭证读取、无真实扣分。
- `README.md`：本说明。

安装地址：`https://raw.githubusercontent.com/Lwn666/loon-plugins/main/ying-signin/ying-signin.plugin`。
脚本地址：`https://raw.githubusercontent.com/Lwn666/loon-plugins/main/ying-signin/ying-signin.js`。
图标地址：`https://raw.githubusercontent.com/Lwn666/loon-plugins/main/icons/ying.png`。

导入插件后，只在本机参数页填写：

| 参数 | 公开默认值 | 说明 |
| --- | --- | --- |
| USERNAME | 空字符串 | 账号/邮箱；仅去除首尾空白，不合并不同大小写账号 |
| PASSWORD | 空字符串 | 密码；不去除空白，不写进缓存 |
| AUTO_RENEW | true | 仅积分会员兑换；不是真钱付费开关 |
| CRONEXP | `10 8 * * *` | cron 使用设备时区；建议设备时区为北京时间 |

不要分享填写了私人参数的配置或本地数据。Loon 参数输入不是本插件实现的保险箱；Cookie 缓存在 Loon 本地存储，切勿导出公开。手动运行入口在插件脚本区/脚本页。

## 签到规则

1. 无缓存会话时 `POST /api/auth/login`，提交 `{identifier,password}`；必须同时取得 `user.id` 和响应 Set-Cookie 的 `stream_session`。兼容 `status`/`statusCode`、大小写不同的 Set-Cookie、多 Cookie 数组/合并字符串；不将 HttpOnly 属性当作 Cookie 内容。
2. `GET /api/me/checkin`。只有 `canCheckin === true`、enabled/webEnabled 均为 true、locked 为 false、未处于 lockedUntil 限制且满足有效会员要求，才获取 `/api/me/checkin/challenge`。
3. 安全递归下降解析整数四则运算、括号、一元正负数、中文/全角乘除及部分常见题目前后缀；不执行题目代码。除零、任何一步非整数除法、非法字符、超出安全整数或过深括号一律不提交。真实 challenge 的完整成功题面尚未知；不认识的题面宁可停，不猜答案。
4. 只提交 `{challengeId, answer:数字}` 到 `/api/me/checkin`，不调用任何补签/下载加成接口，也不消费 `downloadBonusCheckins`。已签到或 `canCheckin === false` 时不取挑战、不 POST。
5. `mode=daily` 使用北京时间减 `dailyResetHour` 后的周期编号防重（例如08:00重置，不以午夜分周期）。本周期 lastCheckinAt 已有签到则不消费额外次数；07:00签的上周期不阻挡08:10新周期。提交前保存周期尝试标记；网络不确定后同一周期保守停止，下一周期可重新评估。`mode=interval` 尊重 nextCheckinAt 并按服务器窗口防重，不按自然日硬挡；未知模式/重置参数不猜测。
6. 提交后重读签到状态，必须有有效、不过度超前的 lastCheckinAt，且回读未锁定。每日模式要求签到时间在本周期，interval要求时间相较旧值增加且接近本次提交；可识别并发完成的状态。**单凭 HTTP 200 或 canCheckin=false 不报成功**，因为验证失败锁定也可能导致 false。返回 coins/duration 奖励均不靠 message 判成功；通知汇总余额及到期。
7. 签到查询、挑战、提交或回读失败，不阻断独立续期评估。

## 日期、积分与兑换

- 仅解析 `/account` 可见 HTML 中唯一 `<article>`、标题 `<h2>当前订阅</h2>` 下的“到期：年/月/日”。先移除 script/style/template/noscript、注释，不从脚本或其他文章提取日期。不依赖 `/api/auth/me` 的会员时间，也不猜测其他用户 API。
- 登录页、未知/歧义/非法日期、永久/终身会员，不新建兑换。页面结构变化宁可停止。
- 页面只有日期，没有精确到期时刻。`remainingDays = 页面到期日 - 北京时间当天`，按日历天计算，**不声称秒级到期时间**；只有 `<30` 触发，`=30`、`>30` 均不兑换；已过期负天数也可评估。
- 读取 `GET /api/me/coins/redeem` 的 available、membershipEnabled、积分及 cost/min/max。数值未知、不合规、余额不足、天数低于 minimum、AUTO_RENEW=false 都不 POST。
- 一次计划天数为 `min(30, membershipMaxDays, floor(coins / membershipCostPerDay))`，且必须 >= membershipMinDays。成本与天数只接受安全整数；未知小数计价保守停止。
- 唯一兑换类型是 `POST /api/me/coins/redeem {type:'membership', days}`；无隐藏库、注册码、真钱充值或其他兑换。每轮只创建一个兑换意图。

## 网络、防重与本地存储

所有请求固定发往本站 HTTPS，`timeout:15000` 毫秒、`insecure:false`、`auto-redirect:false`、`auto-cookie:false`，Origin/Referer 为本站。只从账号对应缓存取会话，不依赖共享 Cookie jar；不跟随重定向，不把凭证发往其他域名。

- 每轮最多一次认证恢复：401 可以重登；403 必须有明确的未认证代码（如 SESSION_EXPIRED/UNAUTHORIZED）或严格匹配的登录失效文案。锁定、验证错误、未知403不得重登/重放 POST。
- 不重试非幂等 POST 的网络失败、超时、5xx、重定向或未知错误。仅明确未授权允许认证后重放一次；兑换因此可能出现两次 HTTP 尝试，但不是两笔兑换意图。
- 兑换前必须成功持久化 `pending`，包含旧到期日、旧积分、cost、days。POST 无论200/未知/超时均只读回查 `/account` 与兑换余额。只有**日期增加且旧积分减新积分恰为 cost×days**才确认成功并解除 pending。
- 未能双重确认时，pending 无自动过期；下一轮只能继续只读核实，禁止创建新兑换。即使关闭自动续期也可核实旧意图，但不会提交新兑换。后来确认成功的这一轮也不再兑换。
- HTTP 400 仅在响应对象**唯一字段**是结构化 `code: INSUFFICIENT_COINS` 或 `INSUFFICIENT_BALANCE` 时按明确拒绝释放 pending；任何额外文案/结果字段都保留并只读核实，绝不凭“积分不足/余额不足”子串判断（“不是积分不足”不能释放）。未知或矛盾 code/message/success 不释放，不宣称未扣费。不根据未知200响应中的 message 自称成功。
- 本地 missing/undefined 与明确 JSON null 才表示没有 pending；false、0、空字符串、原始空字节、数组、空对象及其他损坏记录全部阻断新兑换，不自动清理。
- 不提供自动清 pending 开关。若长期待核实，请先人工对照网站到期日、余额、交易记录，再决定是否单独重置该账号的 pending；不要清空整个 Loon 存储。外部充值、另一次签到、人工兑换等并发余额变化可能导致无法严格证明，保留 pending 是预期保守行为。
- 账号隔离键前缀：`ying.v1.` + `encodeURIComponent(USERNAME.trim())` + `.`，分别保存 cookie/pending/lock/checkinAttempt；不缓存密码。用户名作为本地键的一部分不是加密/脱敏标识，不公开存储导出。
- 所有 `store.save` 检查 `$persistentStore.write` 是否严格返回 true，失败直接显示错误；不调用可能清空全部数据的 `$persistentStore.remove()`。单项释放保存 JSON `null`。
- 每账号运行锁 TTL 240 秒，长于脚本180秒时限；写后回读 token，提交前校验，释放仅限本人 token。接近时限不再启动新请求。**persistentStore 非原子，无 CAS，无法完全保证真正并发安全**；勿同时跑 cron 与手动、勿在其他设备上并行兑同一账号。TTL 只是陈旧锁恢复，不是交易锁。
- 通知包含签到、积分、日期/剩余天数、续期结论；不输出原始 body/header/HTML、账号、密码或 Cookie。日志只有同一精简摘要，异常使用脚本自有错误码。

## 离线检查

```sh
cd /var/minis/shared/loon-plugins/ying-signin
node test.js
python3 /var/minis/skills/loon/scripts/script_v2_convert.py lint ying-signin.plugin
```

测试固定 mock 时间为 2026-11-26，读取真实生产文件；沙箱没有 require/Buffer/atob/document/fetch，只有测试进程本身可用 Node。覆盖已签仍续期、29/30/31天、北京跨日、坏日期/脚本假日期/登录页/永久、余额不足、开关、算术成功与坏题、锁定、签到失败独立续期、200不假报、401/403区别、无Cookie、兑换超时不重放、跨运行pending、日期/扣费未变、账号隔离、存储失败、锁TTL/所有权。

## 验证范围与限制

**真接口验证（2026-11-26）**：生产脚本在 Node VM 桥接 curl 执行，完成账号密码登录、已签到状态读取、积分及页面日期读取、**唯一1次会员兑换 POST（30天）**和双重回读：积分 **179 → 89**，页面到期日期 **2026/12/1 → 2026/12/31**。真实兑换响应包含 `success:true`、`coinsLeft:89`、`expiresAt:'2026-12-30T17:30:00.000Z'`（北京时间2026-12-31 01:30:00）。这是生产脚本本体对真实接口的测试，**不是 Loon App 真机测试**；插件触发条件仍只使用页面日历日期，不把此单次响应时间当作所有账号的精确到期依据。

当次真实账号已签到，下一次窗口为 **2026-11-27 08:00 北京时间**，所以新挑战/签到成功分支仍仅有 mock 覆盖。Loon 真机、真实挑战完整题面及服务端延迟结算情况未验证。Node mock 不等于 JavaScriptCore 或插件安装测试；不确定时保留 pending 并通知，不自动补偿或再次扣分。修复后的完整离线回归为 **79/79 passed; 0 failed**，插件 v2 lint 输出 `OK: 未发现新语法问题`。
