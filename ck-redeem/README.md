# B站兑换码自动兑换（Loon 插件）

复用 B 站 Cookie，捕获公益站登录态，定时检测 UP 主动态里的兑换码并自动兑换。

## 导入

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/ck-redeem/ck-redeem.plugin
```

## 使用

1. **准备 B 站 Cookie**（存储 key `ck_bili_cookie`）
   打开 Safari 登录 B 站，或复用其他插件已捕获的 Cookie。
2. **捕获公益站登录态**
   打开 `api.910501.xyz` 并登录 → 自动捕获 `access_token` + `refresh_token`，
   持久化在手机端 `$persistentStore`，**不会上传**。
   `refresh_token` 过期时，重新打开公益站任意页面即自动更新。
3. **自动兑换**
   按检测频率（默认每 2 分钟）拉取 UP 主动态，命中兑换码即自动兑换并推送通知。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| CRON | `*/2 * * * *` | 检测频率 |
| ENABLE_CAPTURE | on | 公益站登录态捕获 |
| ENABLE_REDEEM | on | 自动兑换 |
| DEBUG | off | 详细日志 |

## 说明

- 需要信任 Loon CA 证书（MitM `api.910501.xyz`）。
- 凭证只存手机端本地，仓库内不含任何凭证。
