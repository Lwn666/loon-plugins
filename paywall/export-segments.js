/*
 * 付费墙解锁 - 片段导出脚本（generic 手动触发）
 * 功能：读取最近解锁的视频片段，生成下载+拼合命令，复制到剪贴板并推通知。
 * 在 Loon 里点一下这个脚本即可运行。
 */

function pad(n) { return (n < 10 ? "0" : "") + n; }

try {
  var lastProject = $persistentStore.read("paywall_last_project");
  if (!lastProject) {
    $notification.post("🎬 付费墙解锁", "暂无记录", "请先打开视频详情页完成解锁");
    $done({});
  } else {
    var detail = $persistentStore.read("paywall_detail_" + lastProject);
    if (!detail) {
      $notification.post("🎬 付费墙解锁", "无片段数据", "ProjectId: " + lastProject);
      $done({});
    } else {
      var data = JSON.parse(detail);
      var segs = data.segments || [];
      var name = data.activityName || data.projectId || "未知视频";

      var lines = [];
      lines.push("# " + name);
      lines.push("ProjectId: " + data.projectId);
      lines.push("完整时长: " + (data.duration / 1000).toFixed(2) + "s (片段" + segs.length + "个)");
      lines.push("");
      lines.push("## 片段 URL（按顺序）");
      segs.forEach(function (s, i) {
        lines.push((i + 1) + ". [" + s.type + "] " + s.dur + "ms");
        lines.push("   " + s.url);
      });
      lines.push("");
      lines.push("## 一键下载 + 拼合（Linux/macOS/终端）");
      segs.forEach(function (s, i) {
        lines.push('curl -o ' + pad(i) + '.mp4 "' + s.url + '"');
      });
      var concat = "";
      segs.forEach(function (s, i) {
        concat += "file '" + pad(i) + ".mp4'\n";
      });
      lines.push('printf "' + concat + '" > concat.txt');
      lines.push("ffmpeg -y -f concat -safe 0 -i concat.txt -c copy full_video.mp4");

      var fullText = lines.join("\n");

      // 复制到剪贴板
      try { $clipboard.text = fullText; } catch (e) { console.log("[export] 剪贴板失败: " + e); }

      console.log("[export] === 片段导出开始 ===");
      console.log(fullText);
      console.log("[export] === 片段导出结束 ===");

      $notification.post(
        "🎬 片段已导出",
        name,
        "已复制 " + segs.length + " 个片段 URL 和 ffmpeg 命令到剪贴板",
        ""
      );
      $done({});
    }
  }
} catch (e) {
  console.log("[export] 异常: " + e);
  $notification.post("🎬 付费墙解锁", "导出失败", String(e));
  $done({});
}
