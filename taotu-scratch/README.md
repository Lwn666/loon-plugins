# 淘图社区 签到 + 会员自动续期（Loon 插件）

[ue2.taotu.ink](https://ue2.taotu.ink)（EmbyPulse 用户社区）每日自动签到；会员快到期时自动用积分兑换月卡续期；站点开启刮刮乐时可一并自动刮。

> 面板在 2026-11-25 曾整站切到 FlixPilot（乐蛙影视），11-28 又回退到 EmbyPulse 旧版。
> 本插件按**当前现网（EmbyPulse）接口**编写；FlixPilot 版源码归档在仓库提交 `f60412e`。

## 功能

- 每天定时：**签到 → 续期检查 →（可选）刮刮乐**，一条通知汇总
- **会员自动续期**：剩余天数 ≤ 阈值（默认 30 天）时，用积分兑换「月卡」（3000 积分 / 30 天）
- 复用本地 `session_id`；失效自动用账号密码重新登录并覆盖
- 兑换带 `request_id` 幂等键：失败重试沿用同一个请求号，服务端不会重复扣分
- 积分不足 → 只发通知不扣分

## 安装

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/taotu-scratch/taotu-scratch.plugin
```

Loon → 配置 → 插件 → 右上角 `+` → 粘贴链接 → 安装。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| **账号** | `kkpkkp` | Emby 社区账号 |
| **密码** | 空 | **必填**，只存本机 |
| 自动续期 | 开 | 关掉后只签到，不兑换 |
| 续期阈值 | 30 | 会员剩余天数 ≤ 该值时触发 |
| 刮刮乐张数 | 0 | 0=不刮；站点未开启时会自动跳过 |
| 结果通知 | 开 | 关闭后只写日志 |
| 执行时间 | `5 8 * * *` | 每天 08:05，cron 表达式 |

## 接口（EmbyPulse 旧版现网）

| 步骤 | 接口 | 说明 |
|---|---|---|
| 登录 | `POST /api/requests/auth` | `Set-Cookie: session_id` |
| 校验 | `GET /api/requests/check` | `{status, user:{Id,Name,expire_date}}` |
| 积分 | `GET /api/user/points/info` | `{data:{points, has_checked_in, config}}` |
| 签到 | `POST /api/user/points/checkin` | `{status, reward, balance}` |
| 补给站 | `GET /api/points/config` | `data.store_items` 是 **JSON 字符串**，需二次 parse |
| 兑换 | `POST /api/user/points/redeem` `{item_id,request_id}` | 返回 `new_expire / previous_expire / added_days / permission_sync` |
| 刮卡 | `POST /api/scratch/buy`、`/api/scratch/reveal {cell_index}` | 需 `enable_web_scratch=1` |

补给站档位（均为 100 积分/天）：天卡 100/1天、周卡 700/7天、半月卡 1500/15天、**月卡 3000/30天**、邀请码 3500（manual，不参与续期）。

## 续期策略

1. `expire_date` 是 `YYYY-MM-DD`（北京时间）；`3000-…`/非日期视为永久，直接跳过。
2. 剩余天数 ≤ 阈值 → 取补给站的**月卡**（`type=renew` 且 28~31 天；注意「半月卡」也含「月卡」二字，代码按天数匹配而非名字）。
3. 积分不足则通知，不做降级购买。
4. 兑换成功以返回的 `new_expire` 为准，不额外轮询。

## 注意

- 账号密码只存手机端（插件参数 + `$persistentStore`），不上传任何服务器
- 签到奖励由站点配置（当前 100~120 积分），脚本只如实回报
- 兑换失败（如 Emby 权限同步失败）时保留 `request_id`，下次运行沿用同一个号安全重试
- `permission_sync=pending` 表示站点侧稍后自动补权限，属正常，不要重复购买
