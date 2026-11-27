# Readify 阅读签到

Readify 阅读 App「7 天挑战」自动签到 + 本轮奖励领取（Loon 插件）。

## 功能

- 打开 Readify App / 签到页自动捕获凭证（`x-token` / `x-user-id` / `x-device-id`），无需手动填写
- 每天 08:00 自动执行：查状态 → 可签到则签到 → 重查状态 → 可领奖则领奖 → 一条推送汇报
- 已签到的日子仍会检查本轮奖励（第 7 天达成后奖励需单独领取）
- Loon 首页可手动触发立即执行

## 安装

插件地址（Loon → 配置 → 插件 → 添加）：

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/readify-signin/readify-signin.plugin
```

装好后打开一次 Readify App（书架/首页/签到页均可），完成凭证捕获。之后每天自动执行。

## 接口说明

认证不是 Cookie，而是请求头（来自抓包）：

| 头 | 说明 |
|---|---|
| `x-token` | JWT，`type=LOGIN`，实测有效期 **7.33 天**（exp − iat = 633600s） |
| `x-user-id` | 用户 UUID |
| `x-device-id` | 设备 UUID |

| 动作 | 请求 | 关键返回 |
|---|---|---|
| 状态 | `GET /api/campaigns/streaks/status?campaignId=<ID>` | `canCheckIn` / `streakedToday` / `canClaim` / `roundStatus` |
| 签到 | `POST /api/campaigns/streaks`，body `{"campaignId":"<ID>"}` | `data.checkInResult = "CHECKED_IN"` |
| 领奖 | `POST /api/campaigns/streaks/reward-claims`，body `{"campaignId":"<ID>"}` | `data.claimResult = "CLAIMED"`，另含 `rewardType` / `rewardCount` / `ultraHdDays` / `claimedAt` / `nextAvailableAt` |

`roundStatus` 取值：`DAY1_READY` / `IN_PROGRESS` / `CLAIMABLE`（可领奖）/ `CLAIMED_WAITING`（已领，等下一轮）。

领奖实测返回（2026-11-27）：

```json
{"code":0,"message":"Success","data":{"campaignId":"reading-streak-7d-202607",
 "claimResult":"CLAIMED","rewardType":"VOICE_SEAT","rewardCount":2,
 "ultraHdDays":7,"claimedAt":1795788398181,"nextAvailableAt":1795795200000}}
```

即「语音席位 ×2 + 超清 7 天」，`nextAvailableAt` 为次日 00:00（活动时区 `Asia/Hong_Kong`）。

## 安全设计（领奖是状态变更请求）

- 领奖 POST **不自动重试**，避免网络抖动导致重复提交
- 结果不明（网络错误 / 返回非 `CLAIMED`）时只做**只读状态回查**：`claimedAt` 有值且 `canClaim=false` 即视为已到账，否则报「领奖结果未知，请在 App 内确认」
- 是否领奖完全以服务端 `canClaim` 为准，不做本地「今天领过就跳过」的误判
- 服务端对坏 token 返回 **HTTP 200 + `code:200000` "Invalid user token"**（不是 401/403），脚本按 code + message 判定凭证失效

## 注意事项

- **token 约 7 天过期**：剩不足 24 小时会在推送里提示；收到「🔑 凭证失效」后重新打开一次 Readify App 即可刷新。
- **活动 ID**：默认 `reading-streak-7d-202607`。若官方更换活动，在插件参数「活动ID」里改成新值。
- 凭证仅存本机 `$persistentStore`，不上传。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| 活动ID | `reading-streak-7d-202607` | 7 天挑战活动 ID |
| 签到时间 | `0 8 * * *` | cron 表达式 |
| 凭证自动捕获 | 开 | 打开 App 时更新 token |
| 捕获时通知 | 开 | 凭证更新时推送 |
| 调试模式 | 关 | 输出详细日志 |

## 本地测试

```bash
node mock-test.js   # 10 个桩用例：签到+领奖全链路 / 仅领奖 / 已领 / 已领过回查 / 网络错误 / token 失效 / 活动未开始
node selftest.js    # 用抓包里的真实 token 打真实接口（当前状态为已领，只发 GET，POST 数为 0）
```
