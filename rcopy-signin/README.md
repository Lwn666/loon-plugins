# Rcopy 自动签到 (rcopy-signin)

Rcopy 小程序（wx74846d51d020b58f）每日自动签到。打开小程序自动捕获凭证，定时签到并推送结果。

## 安装

1. Loon → 插件 → 添加 → `rcopy-signin.plugin`
2. 开启「凭证自动捕获」开关（默认已开）
3. 打开 Rcopy 小程序随便逛一页 → 收到「凭证已自动更新」通知即成功
4. 每天 08:00 自动签到（可在插件参数改时间）

导入链接：

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/rcopy-signin/rcopy-signin.plugin
```

## 凭证机制

| 项 | 说明 |
|---|---|
| 捕获来源 | 小程序任意请求的 body（`{phone, token, system_type}`）或 `Authorization` / `token` 请求头 |
| 存储位置 | `$persistentStore` 的 `rcopy_phone` / `rcopy_token` / `rcopy_capture_time` |
| token 有效期 | JWT `exp` 约 7 天（`iat` + 604800 秒） |
| 过期处理 | 脚本本地解析 JWT 预判过期；服务端失效时通知「凭证已失效」→ 重新打开小程序刷新 |

凭证优先级：**自动捕获 → 插件参数 `phone`/`token`**。参数留空即可，捕获到的值会覆盖。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `phone` | 空 | 手机号，留空用自动捕获值 |
| `token` | 空 | 可留空 |
| `CRONEXP` | `0 8 * * *` | 签到时间（5 段 cron） |
| `CAPTURE_ENABLE` | 开 | 是否自动捕获凭证 |
| `NOTICE` | 开 | 捕获成功是否推送通知 |
| `DEBUG` | 关 | 输出响应头等详细日志 |

## 接口记录

```
POST https://rcopy.nikola-lab.cn/server2/thinkphp/public/index.php/api/Newsignin/SignIn
Content-Type: application/json
body: {"phone":"<11位手机号>","token":"<JWT>","system_type":"WeChat:ios"}
```

- 必须带小程序 UA + `Referer: https://servicewechat.com/wx74846d51d020b58f/113/page-frame.html`
- 服务端错误返回**纯文本**而非 JSON（实测 `token已经过期`），脚本对文本响应做关键词判定
- 接口可达性：直连 HTTP 200，约 0.37s

## 文件

```
rcopy-signin.plugin   # 插件主文件
rcopy-capture.js      # 凭证捕获（http-request）
rcopy-signin.js       # 签到执行（cron / generic）
```
