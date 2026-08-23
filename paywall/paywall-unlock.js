var SBOX_INV = new Uint8Array([0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d]);
var SBOX = new Uint8Array([0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16]);
var RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
function xtime(x){ return ((x<<1) ^ ((x>>7)*0x1b)) & 0xff; }
function mul(a,b){ var r=0; while(b){ if(b&1)r^=a; a=xtime(a); b>>=1; } return r; }
function keyExpansion(keyBytes){
  var w = new Uint8Array(176);
  for(var i=0;i<16;i++) w[i]=keyBytes[i];
  var by=16, rcon=0;
  while(by<176){
    var t0=w[by-4],t1=w[by-3],t2=w[by-2],t3=w[by-1];
    if(by%16===0){ var tmp=t0; t0=SBOX[t1]; t1=SBOX[t2]; t2=SBOX[t3]; t3=SBOX[tmp]; t0^=RCON[rcon++]; }
    w[by]=w[by-16]^t0; w[by+1]=w[by-15]^t1; w[by+2]=w[by-14]^t2; w[by+3]=w[by-13]^t3;
    by+=4;
  }
  return w;
}
function addRoundKey(state,w,round){ var s=round*16; for(var i=0;i<16;i++) state[i]^=w[s+i]; }
function invSubBytes(state){ for(var i=0;i<16;i++) state[i]=SBOX_INV[state[i]]; }
function invShiftRows(state){
  var t;
  t=state[13];state[13]=state[9];state[9]=state[5];state[5]=state[1];state[1]=t;
  t=state[2];state[2]=state[10];state[10]=t; t=state[6];state[6]=state[14];state[14]=t;
  t=state[3];state[3]=state[7];state[7]=state[11];state[11]=state[15];state[15]=t;
}
function invMixColumns(state){
  for(var c=0;c<4;c++){
    var i=c*4, a0=state[i],a1=state[i+1],a2=state[i+2],a3=state[i+3];
    state[i]=mul(a0,14)^mul(a1,11)^mul(a2,13)^mul(a3,9);
    state[i+1]=mul(a0,9)^mul(a1,14)^mul(a2,11)^mul(a3,13);
    state[i+2]=mul(a0,13)^mul(a1,9)^mul(a2,14)^mul(a3,11);
    state[i+3]=mul(a0,11)^mul(a1,13)^mul(a2,9)^mul(a3,14);
  }
}
function aesDecryptBlock(block,keyBytes){
  var w=keyExpansion(keyBytes);
  var state=new Uint8Array(block);
  addRoundKey(state,w,10);
  for(var round=9;round>=1;round--){ invShiftRows(state); invSubBytes(state); addRoundKey(state,w,round); invMixColumns(state); }
  invShiftRows(state); invSubBytes(state); addRoundKey(state,w,0);
  return state;
}
function aesCbcDecrypt(keyBytes,ivBytes,ctBytes){
  var n=ctBytes.length/16, out=new Uint8Array(ctBytes.length), prev=ivBytes;
  for(var b=0;b<n;b++){
    var block=ctBytes.slice(b*16,(b+1)*16);
    var dec=aesDecryptBlock(block,keyBytes);
    for(var i=0;i<16;i++) out[b*16+i]=dec[i]^prev[i];
    prev=block;
  }
  var pad=out[out.length-1];
  if(pad>=1&&pad<=16){ var ok=true; for(var k=1;k<=pad;k++) if(out[out.length-k]!==pad) ok=false; if(ok) out=out.slice(0,out.length-pad); }
  return out;
}


var AES_KEY = "7749174464527483";
var DEBUG = false;

function utf8ToBytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xc0|(c>>6), 0x80|(c&0x3f)); }
    else if (c < 0xd800 || c >= 0xe000) { bytes.push(0xe0|(c>>12), 0x80|((c>>6)&0x3f), 0x80|(c&0x3f)); }
    else { i++; c = 0x10000 + (((c&0x3ff)<<10)|(str.charCodeAt(i)&0x3ff)); bytes.push(0xf0|(c>>18), 0x80|((c>>12)&0x3f), 0x80|((c>>6)&0x3f), 0x80|(c&0x3f)); }
  }
  return bytes;
}
function bytesToUtf8(bytes) {
  var str = "", i = 0;
  while (i < bytes.length) {
    var b = bytes[i];
    if (b < 0x80) { str += String.fromCharCode(b); i++; }
    else if (b < 0xe0) { str += String.fromCharCode(((b&0x1f)<<6)|(bytes[i+1]&0x3f)); i+=2; }
    else if (b < 0xf0) { str += String.fromCharCode(((b&0x0f)<<12)|((bytes[i+1]&0x3f)<<6)|(bytes[i+2]&0x3f)); i+=3; }
    else { var cp = ((b&0x07)<<18)|((bytes[i+1]&0x3f)<<12)|((bytes[i+2]&0x3f)<<6)|(bytes[i+3]&0x3f); cp -= 0x10000; str += String.fromCharCode(0xd800|(cp>>10), 0xdc00|(cp&0x3ff)); i+=4; }
  }
  return str;
}
function base64ToBytes(b64) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = new Array(256);
  for (var i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  b64 = b64.replace(/[\r\n\s]+/g, "").replace(/=+$/, "");
  var len = b64.length;
  var out = [];
  var buffer = 0, bits = 0;
  for (var i = 0; i < len; i++) {
    var val = lookup[b64.charCodeAt(i)];
    if (val === undefined) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
function decryptBody(b64Text) {
  var raw = base64ToBytes(b64Text);
  if (raw.length < 32) return null;
  var iv = raw.slice(0, 16);
  var ct = raw.slice(16);
  var keyBytes = utf8ToBytes(AES_KEY);
  return bytesToUtf8(aesCbcDecrypt(keyBytes, iv, ct));
}

// 从明文提取单个字段（正则）
function getField(plain, key) {
  var re = new RegExp('"' + key + '"\\s*:\\s*("([^"]*)"|\\d+)');
  var m = plain.match(re);
  if (!m) return null;
  if (m[2] !== undefined) return m[2];
  return parseInt(m[1], 10);
}

// ==================== 主逻辑 ====================
function bodyToString(body) {
  // Loon 的 $response.body 可能是 string 或 Uint8Array
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array || (body && typeof body.length === "number" && typeof body.byteLength === "number")) {
    var bin = "";
    for (var i = 0; i < body.length; i++) bin += String.fromCharCode(body[i]);
    return bin;
  }
  if (body && typeof body === "object" && body.constructor && body.constructor.name === "Uint8Array") {
    var b2 = "";
    for (var j = 0; j < body.length; j++) b2 += String.fromCharCode(body[j]);
    return b2;
  }
  return String(body || "");
}

try {
  console.log("[paywall] 脚本启动, url=" + $request.url);
  if (!/microfilm\.good-wesee\.com/.test($request.url)) {
    console.log("[paywall] URL 不匹配，跳过");
    $done({});
  } else {
    var body = $response.body;
    console.log("[paywall] body 类型: " + (body === undefined ? "undefined" : body === null ? "null" : Object.prototype.toString.call(body)) + ", 长度: " + (body ? (body.length || body.byteLength || 0) : 0));

    var bodyStr = bodyToString(body);
    console.log("[paywall] body 转 string 后长度: " + bodyStr.length + ", 前30字符: " + bodyStr.substring(0, 30));

    if (bodyStr.length > 32) {
      var plain = decryptBody(bodyStr);
      if (plain && plain.trim().length > 0) {
        console.log("[paywall] 解密成功 len=" + plain.length);
        var url = $request.url;

        if (/\/mediayong\//.test(url)) {
          try {
            var segRe = /"VideoType"\s*:\s*"(\w+)"[^{}]*?"VideoDuration"\s*:\s*(\d+)/g;
            var urlRe = /"(VideoUrl_OSS|VideoPath_COS)"\s*:\s*"([^"]+)"/g;
            var types = [], durs = [], urls = [], m;
            while ((m = segRe.exec(plain)) !== null) { types.push(m[1]); durs.push(parseInt(m[2], 10)); }
            while ((m = urlRe.exec(plain)) !== null) { urls.push({ kind: m[1], url: m[2] }); }
            var segs = [];
            for (var i = 0; i < urls.length; i++) segs.push({ type: types[i] || "?", dur: durs[i] || 0, url: urls[i].url });

            var projectId = getField(plain, "ProjectId") || url.replace(/.*\//, "");
            var activityName = getField(plain, "activityName") || "";
            var duration = getField(plain, "duration") || 0;
            var durationCut = getField(plain, "duration_cut") || 0;
            var preview = getField(plain, "MediaURLPreview") || "";

            console.log("[paywall] 片段数=" + segs.length + " ProjectId=" + projectId);

            if (segs.length > 0) {
              var payload = { projectId: projectId, activityName: activityName, duration: duration, durationCut: durationCut, preview: preview, segments: segs };
              $persistentStore.write(JSON.stringify(payload), "paywall_detail_" + projectId);
              $persistentStore.write(projectId, "paywall_last_project");
              var total = segs.reduce(function (a, b) { return a + (b.dur || 0); }, 0);

              // 生成导出内容（curl 下载 + ffmpeg 拼合命令）
              function pad2(n) { return (n < 10 ? "0" : "") + n; }
              // 从明文提取视频名（activityName 优先，缺省用 templateName）
              var nameFromPlain = getField(plain, "activityName") || getField(plain, "templateName") || "";
              var expLines = [];
              expLines.push("===== 片段导出开始 =====");
              expLines.push("视频: " + (nameFromPlain || activityName || projectId));
              expLines.push("ProjectId: " + projectId);
              expLines.push("完整时长: " + (duration/1000).toFixed(2) + "s (片段" + segs.length + "个)");
              expLines.push("");
              expLines.push("--- 预览版(试看)下载 ---");
              if (preview) {
                expLines.push("curl -o preview.mp4 \"" + preview + "\"");
              } else {
                expLines.push("(无预览地址)");
              }
              expLines.push("");
              expLines.push("--- 一键下载+拼合 ---");
              segs.forEach(function (s, i) { expLines.push('curl -o ' + pad2(i) + '.mp4 "' + s.url + '"'); });
              var concatLines = "";
              segs.forEach(function (s, i) { concatLines += "file '" + pad2(i) + ".mp4'\n"; });
              expLines.push('printf "' + concatLines + '" > concat.txt');
              expLines.push("ffmpeg -y -f concat -safe 0 -i concat.txt -c copy full_video.mp4");
              expLines.push("===== 片段导出结束 =====");
              var exportText = expLines.join("\n");

              console.log(exportText);
              $notification.post("🎬 完整视频已解锁", activityName || "视频详情", "共 " + segs.length + " 个片段\nProjectId: " + projectId + "\n完整时长 " + (duration/1000).toFixed(2) + "s\n\n片段URL已输出到日志", "");
              console.log("[paywall] ✅ 通知已推送");
            } else {
              console.log("[paywall] ⚠️ 片段数为0");
            }
          } catch (e) {
            console.log("[paywall] 详情解析失败 " + e);
          }
        }
        else if (/\/mediauyong\//.test(url)) {
          try {
            var cnt = (plain.match(/"recordId"/g) || []).length;
            console.log("[paywall] 列表记录数=" + cnt);
            if (cnt > 0) {
              var recRe = /"recordId"\s*:\s*(\d+)[^{}]*?"ProjectId"\s*:\s*"([^"]+)"/g;
              var list = [], mm;
              while ((mm = recRe.exec(plain)) !== null) list.push({ recordId: parseInt(mm[1], 10), projectId: mm[2] });
              $persistentStore.write(JSON.stringify(list), "paywall_list");
              console.log("[paywall] ✅ 列表已存 " + list.length + " 条");
            }
          } catch (e) {
            console.log("[paywall] 列表解析失败 " + e);
          }
        }
      } else {
        console.log("[paywall] ⚠️ 解密失败或明文为空");
      }
    } else {
      console.log("[paywall] ⚠️ body 长度不足 32");
    }
    $done({});
  }
} catch (e) {
  console.log("[paywall] 异常: " + e);
  console.log("[paywall] 异常堆栈: " + (e.stack || "无"));
  $done({});
}
