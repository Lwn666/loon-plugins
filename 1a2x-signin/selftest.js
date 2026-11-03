/*
 * selftest.js — 在 node 里仿真 Loon 运行时，用真实接口验证 1a2x-signin.js
 * 用法：
 *   A2X_COOKIE='__Host-nc.sid=s%3A...' node selftest.js      # 带真实凭证跑全流程
 *   node selftest.js                                        # 无凭证，验证「缺少凭证」分支
 *
 * 保真要点：$httpClient 的 timeout 单位是毫秒，这里原样传给 https.request。
 * 注意：默认不跟随重定向（与 Loon 的 302 行为对齐时可观察 status/Location）。
 */
const fs = require("fs");
const https = require("https");
const { URL } = require("url");

const COOKIE = (process.env.A2X_COOKIE || "").trim();
const UA = (process.env.A2X_UA || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1").trim();

const store = {};
if (COOKIE) {
  store.a2x_cookie = COOKIE;
  store.a2x_user_agent = UA;
  store.a2x_capture_time = String(Date.now());
}

global.$persistentStore = {
  read: (k) => store[k] || "",
  write: (v, k) => { store[k] = v; return true; },
};
global.$notification = {
  post: (title, sub, msg) => {
    console.log("\n=== NOTIFICATION ===");
    console.log("标题: " + title);
    console.log("副标题: " + sub);
    console.log("内容: " + String(msg).replace(/\n/g, " / "));
    console.log("===================\n");
  },
};
global.$done = () => console.log("[done]");
global.$argument = JSON.stringify({ DEBUG: "true" });

function realHttp(opts, method, cb) {
  const u = new URL(opts.url);
  const headers = Object.assign({}, opts.headers || {});
  const payload = opts.body ? Buffer.from(opts.body, "utf8") : null;
  if (payload) headers["Content-Length"] = payload.length;
  const req = https.request({
    hostname: u.hostname,
    port: 443,
    path: u.pathname + u.search,
    method,
    headers,
    rejectUnauthorized: false,
    timeout: opts.timeout || 15000,
  }, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      console.log(`-- ${method} ${opts.url} -> ${res.statusCode} len=${body.length} location=${res.headers.location || "-"}`);
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

const code = fs.readFileSync(__dirname + "/1a2x-signin.js", "utf8");
console.log("=== 运行 1a2x-signin.js（真实接口）===\n");
eval(code);
