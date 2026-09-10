# OMG 心跳乐园韵味摄影视频解锁（Loon 插件）

解密 **OMG 心跳乐园韵味摄影**（微信小程序）付费视频，旁路提取完整视频的合成片段 URL。

## 导入

Loon → 配置 → 插件 → 添加：

```
https://raw.githubusercontent.com/Lwn666/loon-plugins/main/paywall/paywall-unlock.plugin
```

## 原理

OMG 心跳乐园韵味摄影小程序的付费视频在客户端由 **AES-128-CBC** 加密返回，
key 硬编码在客户端（`7749174464527483`，已实测验证）。

本插件在 **response 阶段**拦截 `microfilm.good-wesee.com:46735` 的响应，
用纯 JS 实现 AES 解密（不依赖外部库，兼容 Loon 的 JavaScriptCore 沙箱），
从明文里提取 `VideoUrl_OSS` / `VideoPath_COS` 片段列表，拼出完整视频。

## 使用

1. 装好插件后打开视频详情页，自动解锁
2. 解密到完整片段时推送通知（可关）
3. 导出命令输出到 **Loon 日志**（curl 下载 + ffmpeg 拼合）

导出的命令形如：

```sh
curl -o 00.mp4 '<片段URL1>'
curl -o 01.mp4 '<片段URL2>'
...
printf "file '00.mp4'\nfile '01.mp4'\n" > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy full_video.mp4
```

## 插件参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `NOTIFY` | 开 | 解密到完整视频片段时推送通知 |
| `DEBUG` | 关 | 输出详细诊断日志（body 类型/长度、解密结果、片段数等） |

## 文件

| 文件 | 说明 |
|---|---|
| `paywall-unlock.plugin` | 插件配置（Argument + Script + MITM） |
| `paywall-unlock.js` | 主脚本（纯 JS AES-128-CBC 解密 + 片段提取） |

## 注意

- 需要 **MitM 开启**并信任 Loon 证书，插件已声明 `[MITM] hostname`
- 端口 `46735` 是硬编码的，站点若更换端口需同步改正则
- 仅在 iOS 上测试（`#!system=iOS`）

## 校验

```sh
node --check paywall-unlock.js
python3 script_v2_convert.py lint paywall-unlock.plugin
node test_args.js paywall-unlock.js    # 参数解析
```
