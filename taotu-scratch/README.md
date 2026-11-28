# 淘图社区 签到 + 刮刮乐（Loon 插件）

[ue2.taotu.ink](https://ue2.taotu.ink)（EmbyPulse 用户社区）每日自动签到 + 自动刮刮乐。

## 功能

- 每天定时执行：**先签到，再刮刮乐**（按站点每日上限，默认 20 张 × 100 分）
- 复用本地 `session_id`（7 天有效），失效自动用账号密码重新登录
- 汇总通知：签到奖励 / 刮卡张数 / 花费 / 中奖 / 净收益 / 当前积分
- 支持手动触发（Loon 首页「淘图手动跑一次」）

## 安装

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/taotu-scratch/taotu-scratch.plugin
```

Loon → 配置 → 插件 → 右上角 `+` → 粘贴上面的链接 → 安装。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| **账号** | `kkpkkp` | Emby 社区账号 |
| **密码** | 空 | **必填**，只存本机 |
| 每日张数上限 | 20 | 站点上限也是 20，填小可少刮 |
| 执行时间 | `5 8 * * *` | 每天 08:05，cron 表达式 |
| 结果通知 | 开 | 关闭后只写日志 |

## 原理

| 步骤 | 接口 |
|---|---|
| 登录 | `POST /api/requests/auth` → `Set-Cookie: session_id`（7 天） |
| 校验 | `GET /api/requests/check` |
| 签到 | `POST /api/user/points/checkin` → `{reward, balance}` |
| 配置 | `GET /api/points/config` → `web_scratch_max_per_day` / `web_scratch_cost` |
| 买卡 | `POST /api/scratch/buy` → `{win_numbers, grid[], new_points}` |
| 刮开 | `POST /api/scratch/reveal` `{"cell_index":n}` → `{number, reward, matched, new_points}` |

- 请求必须带 `Origin` / `Referer` 头，否则服务端报 `CSRF验证失败`
- 服务端每日次数用完会返回 `今日次数已用完（20次/天）`，脚本据此正常停止
- 若某张卡 12 格全部刮开失败（接口变更），脚本立即中止，避免继续白扣积分

## 注意

- 账号密码只存手机端（`$persistentStore` / 插件参数），不上传任何服务器
- 刮刮乐是概率玩法：每张 100 分，中奖 100–200 分/格，收益不保证为正
- 脚本每次运行会新建一个 `session_id`；如果发现网页端掉登录，重新登录一次即可
