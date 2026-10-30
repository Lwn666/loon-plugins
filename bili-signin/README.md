# 📺 BiliBili 每日签到（Loon 插件）

B 站每日任务 + Cookie 获取，移植自 [ClydeTime/BiliBili](https://github.com/ClydeTime/BiliBili)（脚本 V1.5，2025-05-16，作者 MartinsKing）。
脚本与图标已内置本仓库，不依赖上游 raw 地址，上游删库也能继续用。

## 安装

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/bili-signin/bili-signin.plugin
```

Loon → 配置 → 插件 → 添加，粘贴上面的地址。

## 功能

- 登录 / 观看 / 分享 / 投币（投币对象为关注的 UP，硬币不足 5 枚自动停止）
- 直播签到、银瓜子自动兑换硬币
- 大会员大积分签到（可选）
- 年度大会员每月 1 号 / 15 号自动领 5 张 B 币券（可选自动充电，建议在 BoxJS 里确认对象）

## 参数（插件内 Argument 可直接改）

| 参数 | 默认 | 说明 |
|---|---|---|
| `APPCookie` | 开 | 打开 B 站 App 时自动抓取/更新 Cookie（推荐） |
| `扫码Cookie` | 关 | 扫码获取长效 Cookie，用完请关掉，且不要与 APPCookie 同开 |
| `RunTime` | `30 7 * * *` | 每日任务执行时间（cron），默认每天 7:30 |
| `bigPoint` | 关 | 观看剧集大积分任务（大会员） |

## 使用步骤

1. 保持 `APPCookie` 开启，退出并重新打开 B 站 App 进入首页，收到「🎉cookie存储成功」即为抓取成功。
2. 次日 7:30 自动执行，结果通过通知推送。
3. 想调投币数、充电对象、任务开关等详细设置，装 [BoxJS 订阅](https://raw.githubusercontent.com/ClydeTime/BiliBili/main/boxjs/BiliBili.boxjs.json)。

## 注意

- 投币需要账号有足够的关注数；关注太少会失败。
- Cookie 失效（B 站常见）重新打开 App 走一遍第 1 步即可。
- MITM 域名：`app.bilibili.com`。

## 免责

脚本版权归原作者 MartinsKing（@ClydeTime）。此目录仅做镜像与路径改写，仅供学习交流。
