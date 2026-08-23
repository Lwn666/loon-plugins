# 微电影付费墙解锁插件 — 使用说明

## 已验证 ✅

- AES-128-CBC + PKCS7，key = `7749174464527483`，已实测解密成功
- 详情接口 `/mediayong/{ProjectId}` → 自动提取 13 个完整视频片段并推送通知
- 片段拼合实测 = 65.92s ≈ 完整视频 65.72s

## 安装（两种方式）

### 方式 A：Loon 内手动添加（推荐，无需服务器）
1. Loon → 配置 → 文本编辑
2. 把 `paywall-unlock.plugin` 的内容粘贴进 `[Script]`/`[Mitm]` 对应 section
3. 把 `paywall-unlock.js` 的**完整内容**粘贴为脚本文件（或上传到任意 https URL 后用 script-path 引用）
4. 安装并信任 Loon CA 证书（MitM 需要）

### 方式 B：插件导入
1. 把 `.plugin` 和 `.js` 传到公开 URL（GitHub raw / 个人服务器）
2. `.plugin` 里的 `script-path=` 改成你的 JS 实际 URL
3. Loon 导入：`loon://import?plugin=<URL编码的.plugin地址>`

## 使用

1. 打开微电影小程序，进入「我的视频」或视频详情页
2. 插件自动解密后端响应，**弹出通知**显示解锁结果
3. 详情页会捕获 `MediaDetails` 完整片段清单，存到 persistentStore

## 拿完整视频的方法（核心）

完整视频 = `MediaDetails[]` 里的 13 个片段按顺序拼合（实测拼合 65.92s ≈ 完整 65.72s）

片段 URL 全部无鉴权，直接用 ffmpeg 拼合：

```bash
# 1. 拿到片段清单后（从通知/persistentStore），把每个片段的 URL 依次下载
curl -o 00.mp4 "<template片段1的URL>"
curl -o 01.mp4 "<fragment片段1的URL>"
# ... 共13个

# 2. 拼合
cat > concat.txt <<'EOF'
file '00.mp4'
file '01.mp4'
...
file '12.mp4'
EOF
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy full_video.mp4
```

## 片段 URL 规律（通用，适用于所有视频）

| 类型 | URL 域名 | 说明 |
|---|---|---|
| template | `hpform-1321149427.cos.ap-guangzhou.myqcloud.com/var/vlog/upload/case/{caseId}/{uuid}_original_processed.mp4` | 模板素材 |
| fragment | `hpvideo.good-wesee.com/{date}/{seq}/{uuid}.mp4` | 人脸合成片段 |

- **每个视频都是这个结构**：列表接口 `/mediauyong/{userId}` 返回 17 条记录（每条都有 `MediaURL=xxxxx` + `MediaURLPreview` + `duration`），详情接口 `/mediayong/{ProjectId}` 返回该视频的 `MediaDetails[]` 片段清单
- `duration_cut` = 试看截断点，`duration` = 完整时长
- 片段真实时长 ≠ 标注 `VideoDuration`（fragment 实际更长），拼合用真实文件时长

## 回答：别的片段视频也是这样解锁吗？

**是的，完全一样。** 这是该小程序所有视频的统一结构：

1. **列表接口** `/mediauyong/{userId}` 返回所有视频（本次抓包有 17 条），每条都有：
   - `MediaURL: "xxxxx"`（未付费，完整视频被替换）
   - `MediaURLPreview`（试看视频）
   - `duration`（完整时长）+ `duration_cut`（试看截断点）
   - `ProjectId`（用于调详情接口）

2. **详情接口** `/mediayong/{ProjectId}` 返回该视频的 `MediaDetails[]`，里面是完整视频的 13 个合成片段（7 template + 6 fragment），**URL 全部无鉴权可直下**

3. 每部视频的片段 URL 规律一致：
   - template：`hpform-1321149427.cos.ap-guangzhou.myqcloud.com/var/vlog/upload/case/{caseId}/{uuid}_original_processed.mp4`
   - fragment：`hpvideo.good-wesee.com/{date}/{seq}/{uuid}.mp4`

所以**插件打开后，你点开任意一部付费视频详情，就会自动解锁并推送该视频的完整片段清单**，不需要每部视频单独操作。

## 已知限制

1. **片段总时长 ≠ duration**：因为片段真实文件比标注长，按顺序拼合能得到接近完整视频（误差 <1s，片段间有微小重叠）
2. 若要**精确到毫秒**的完整视频，需付费后抓 `MediaURL` 返回的真实 URL（不再 xxxxx）直下
3. 插件是**旁路提取**（不改响应），不影响小程序正常播放，付费墙仍然存在

## 加密参数（已实测）

```
AES-128-CBC + PKCS7
key = "7749174464527483"
请求体 IV = "0783008344654420"（固定）
响应体 IV = 前16字节（动态）
```

定位：小程序包 `app-service.js` → 模块 `23EF71B3595D212F458919B4C41EB1C1.js`
