# Readify 阅读签到

Readify 阅读 App「7 天挑战」每日自动签到（Loon 插件）。

## 功能

- 打开 Readify App 任意页面自动捕获凭证（`x-token` / `x-user-id` / `x-device-id`），无需手动填写
- 每天 08:00 自动签到，结果推送通知（成功 / 今日已签 / 凭证过期）
- Loon 首页可手动触发立即签到

## 安装

插件地址（Loon → 配置 → 插件 → 添加）：

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/readify-signin/readify-signin.plugin
```

装好后打开一次 Readify App（书架/首页/签到页均可），完成凭证捕获。之后每天自动签到。

## 接口说明

认证不是 Cookie，而是请求头（来自抓包）：

| 头 | 说明 |
|---|---|
| `x-token` | JWT，`type=LOGIN`，约 **73 小时**过期 |
| `x-user-id` | 用户 UUID |
| `x-device-id` | 设备 UUID |

- 查询：`GET /api/campaigns/streaks/status?campaignId=<ID>` → `canCheckIn` / `streakedToday`
- 签到：`POST /api/campaigns/streaks`，body `{"campaignId":"<ID>"}`

## 注意事项

- **token 约 3 天过期**：收到「🔑 凭证已过期」通知后，重新打开一次 Readify App 即可刷新。
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
