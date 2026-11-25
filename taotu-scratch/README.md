# 乐蛙影视 签到 + 会员续期（Loon 插件）

[ue2.taotu.ink](https://ue2.taotu.ink)（FlixPilot 面板，站名「乐蛙影视」）每日自动签到领爆米花，
并在会员到期前自动用爆米花兑换月卡续期。

> 2026-11-25 面板整站改版：旧的 `/api/requests/*`、`/api/scratch/*` 接口已废弃，
> 本插件按新面板重写（同文件名，已安装的插件更新后会直接换成本版）。

## 功能

- 每天定时：**先探测签到状态 → 未签到则签到**（站点已签到会返回「今天已经签到过了」，脚本视为正常）
- **复用本地 `auth-token`（HttpOnly cookie）**；`/api/auth/me` 返回 401 时自动用账号密码重新登录并覆盖 token
- **会员到期前自动续期**：剩余天数 ≤ 阈值（默认 30 天）时，用爆米花买**月卡**（3000 爆米花 / 30 天），
  一次运行最多买 3 张；爆米花不足只发通知不扣款
- 通知内容：账号 / 签到结果 / 爆米花余额 / 会员剩余天数 / 是否续期及花费

## 安装

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/taotu-scratch/taotu-scratch.plugin
```

Loon → 配置 → 插件 → 右上角 `+` → 粘贴链接 → 安装。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| **账号** | `kkpkkp` | 乐蛙影视登录账号 |
| **密码** | 空 | **必填**，只存本机 |
| 自动续期 | 开 | 关掉后只签到，不买东西 |
| 续期阈值 | 30 | 会员剩余天数 ≤ 该值时触发续期 |
| 结果通知 | 开 | 关闭后只写日志 |
| 执行时间 | `5 8 * * *` | 每天 08:05，cron 表达式 |

## 接口（2026-11 新版）

| 步骤 | 接口 | 返回 |
|---|---|---|
| 登录 | `POST /api/auth/login` `{username,password}` | `Set-Cookie: auth-token`（HttpOnly） |
| 会话 | `GET /api/auth/me` | `{authenticated, user:{popcorn, membershipExpiry, lastSignIn, signInStreak}}` |
| 规则 | `GET /api/auth/sign-in` | `{enabled, base:{popcorn}, milestones[]}` |
| 签到 | `POST /api/auth/sign-in` | `{success, message, popcorn, streak}` |
| 商城 | `GET /api/shop` | `{items[], wallet:{popcorn,balance}}` |
| 购买 | `POST /api/shop` `{itemId}` | `{wallet, rewardMessage}` |

商城当前档位（均为 100 爆米花/天）：天卡 100/1天、周卡 700/7天、半月卡 1500/15天、**月卡 3000/30天**。
脚本固定优先选月卡；若商城下架月卡，退化为「每天单价最低」的档位。

## 时间口径

站点的 `lastSignIn` 按北京时间记（`YYYY-MM-DD`）。脚本用 UTC+8 计算「今天」，
避免手机时区/iSH 时区导致误判当天是否已签到。

## 注意

- 账号密码只存手机端（插件参数 + `$persistentStore`），不上传任何服务器
- 签到发放的爆米花数量由站点配置（`GET /api/auth/sign-in` 的 `base.popcorn`，当前 115/天）
- 会员到期时间以站点为准；续期后到期日由服务端延长，脚本只读结果
- 若站点改版导致接口 404，脚本会通知「签到失败 - 接口不存在」而不是静默成功
