/*
 * selftest.js — 用真实接口验证 readify-signin.js 的逻辑（在 node 里仿真 Loon 运行时）
 * 用法：node selftest.js    （在 readify-signin/ 目录下）
 * 凭证来源：优先读环境变量 READIFY_TOKEN / READIFY_UID / READIFY_DID，
 *          否则读抓包目录（仅本机调试用）。token 需有效，否则只会走到「凭证失效」分支。
 *
 * ⚠️ 保真要点：$httpClient 的 timeout 单位是【毫秒】。本文件直接把 o.timeout 原样
 *   传给 https.request（也是毫秒），与真机语义一致——不要按「秒」再乘 1000，否则
 *   测试绿了、真机超时（thtv 的 selftest 早期就踩过这个坑）。
 */
const fs = require("fs");
const https = require("https");
const { URL } = require("url");

function envOr(name, fallback) {
  return process.env[name] ? String(process.env[name]).trim() : fallback;
}

// ---- 读取抓包里的真实凭证（或环境变量覆盖）----
const capDir = "/var/minis/workspace/readify/6469_7603_1793440374462";
function hget(file, name) {
  const txt = fs.readFileSync(file, "utf8");
  const lines = txt.split(/\r?\n/);
  for (const ln of lines) {
    const i = ln.indexOf(": ");
    if (i < 0) continue;
    if (ln.slice(0, i) === name) return ln.slice(i + 2).trim();
  }
  return "";
}
let capToken = "", capUid = "", capDid = "";
try {
  capToken = hget(capDir + "/request_header_raw.txt", "x-token");
  capUid = hget(capDir + "/request_header_raw.txt", "x-user-id");
  capDid = hget(capDir + "/request_header_raw.txt", "x-device-id");
} catch (e) {}
const TOKEN = envOr("READIFY_TOKEN", capToken);
const UID = envOr("READIFY_UID", capUid);
const DID = envOr("READIFY_DID", capDid);

// ---- mock $persistentStore ----
const store = {
  readify_token: TOKEN,
  readify_user_id: UID,
  readify_device_id: DID,
};
global.$persistentStore = {
  read: (k) => store[k] || "",
  write: (v, k) => { store[k] = v; return true; },
};

// ---- mock $notification ----
global.$notification = {
  post: (title, sub, msg) => {
    console.log("\n=== NOTIFICATION ===");
    console.log("标题: " + title);
    console.log("副标题: " + sub);
    console.log("内容: " + msg);
    console.log("===================\n");
  },
};
global.$done = () => {};
global.$argument = JSON.stringify({ CAMPAIGN_ID: "reading-streak-7d-202607", DEBUG: "true" });

// ---- mock $httpClient（真实 https 请求）----
function realHttp(opts, method, cb) {
  const u = new URL(opts.url);
  const headers = Object.assign({}, opts.headers || opts.header || {});
  const payload = opts.body ? Buffer.from(opts.body, "utf8") : null;
  if (payload) headers["Content-Length"] = payload.length;
  const req = https.request({
    hostname: u.hostname,
    port: 443,
    path: u.pathname + u.search,
    method: method,
    headers: headers,
    rejectUnauthorized: false,
    timeout: opts.timeout || 15000,
  }, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      cb(null, { status: res.statusCode, headers: res.headers }, body);
    });
  });
  req.on("error", (e) => cb(e, null, null));
  req.on("timeout", () => { req.destroy(new Error("timeout")); });
  if (payload) req.write(payload);
  req.end();
}
global.$httpClient = {
  get: (o, cb) => realHttp(o, "GET", cb),
  post: (o, cb) => realHttp(o, "POST", cb),
};

// ---- 加载并运行真实脚本 ----
const code = fs.readFileSync(__dirname + "/readify-signin.js", "utf8");
console.log("=== 开始运行 readify-signin.js（真实接口）===\n");
eval(code);
