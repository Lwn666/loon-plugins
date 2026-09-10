# 小黑盒限免监控（喜加一）- Loon 插件

自动检测小黑盒的 **Epic / Steam 限时免费游戏**（喜加一）并推送通知。Epic 游戏提供**一键领取链接**（点开即领）。

## 功能

- ✅ 每日定时检测限免（默认 10:00，可自定义 cron）
- ✅ Epic 限免：通知带 **直达领取链接**（需浏览器已登录 Epic）
- ✅ Steam 限免：通知提醒（需小黑盒 App 内领取）
- ✅ 已领取状态检测（owned 字段，不重复提醒）
- ✅ 多账号支持
- ✅ **纯 JS 签名**（web 版 hkey 算法内嵌，不依赖任何外部服务）

## 安装

1. 导入插件：Loon → 插件 → 添加 → `xiaoheihe-free-games.plugin`
2. 配置参数：
   - **Cookie**（必填）：`heybox_id#pkey=xxx;x_xhh_tokenid=xxx`
   - **检查时间**：cron，默认 `0 10 * * *`
3. 开启插件

## 如何领取

**Epic**：通知里点 🔗 链接 → 浏览器打开 Epic 商店（需已登录）→ 自动进入结算页 → 确认免费领取。

**Steam**：小黑盒 App 的「限免」入口 → 一键领取（App 会打开 Steam 登录并注入脚本自动添加）。

## 原理

小黑盒 App 的「免费游戏」页面对应接口 `/mall/add_to_cart/`（web 版签名，7 位字符 hkey，**纯 JS 可实现**）：

- 返回 `games`（限时免费，含 `end_time` 截止时间）
- 返回 `free_games`（永久免费）
- 每个游戏含 `owned`（0=未领 1=已领）、`namespace`+`offerId`（Epic 领取参数）、`package_id`（Steam 领取参数）

本插件仅做**信息检测 + 提醒**。Epic 领取通过官方商店链接完成（`store.epicgames.com/purchase?offers=...`），Steam 领取需小黑盒 App 的 WebView 注入能力（Loon 无法模拟）。

## 免责声明

仅供学习交流使用。限免信息以各商店实际为准，请在截止时间内领取。
