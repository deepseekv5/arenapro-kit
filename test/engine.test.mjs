/**
 * engine.test.mjs — 引擎连接层的闸门测试。
 *
 * 关键不是"能不能跑 apc"，而是**不该跑的时候真没跑**：
 * 写操作缺 confirm 必须被挡住，而且要用标记文件证明进程根本没起来。
 * 用的是假 apc 夹具（本机没装官方 CLI），所以这里验的是我们的白名单与门禁，
 * 不是官方 CLI 的行为。
 */
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { classify, runApc, probeCreator, probeApc } from "../mcp/creator.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const APC = join(HERE, "fixtures", "fake-apc");
const MARK = `/tmp/fake-apc-mark-${process.pid}.txt`;
process.env.FAKE_APC_MARK = MARK;   // runApc 不传 env，靠继承让假 apc 写到这里

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 300) : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(MARK, { force: true });

/* --- 1. 白名单分类 --- */
ok("只读命令归 read", classify(["map", "list"]) === "read" && classify(["script", "get"]) === "read" && classify(["runtime", "status"]) === "read");
ok("写命令归 write", classify(["script", "upload"]) === "write" && classify(["storage", "delete"]) === "write" && classify(["runtime", "stop"]) === "write" && classify(["project", "bind"]) === "write");
ok("没见过的归 unknown", classify(["rm", "-rf"]) === "unknown" && classify(["frobnicate"]) === "unknown");

/* --- 2. runApc 的门禁 --- */
const ro = await runApc(["map", "list"], { bin: APC });
ok("只读命令自动加 --json 并解析", ro.ok === true && ro.data?.count === 1, JSON.stringify(ro).slice(0, 200));
ok("只读命令回显真实命令行", /apc map list --json/.test(ro.command), ro.command);

const blocked = await runApc(["script", "upload", "map-1", "server", "App.js"], { bin: APC }).catch((e) => ({ thrown: String(e.message) }));
const blockedMsg = blocked.thrown || blocked.error || (blocked.data === undefined && JSON.stringify(blocked));
ok("写命令缺 confirm 被拒", /confirm/.test(String(blockedMsg)), String(blockedMsg).slice(0, 200));
ok("被挡下的写命令**真的没执行**（无标记文件）", !existsSync(MARK), existsSync(MARK) ? readFileSync(MARK, "utf8") : "");

const confirmed = await runApc(["script", "upload", "map-1", "server", "App.js", "--file", "./dist/server/App.server.js"], { bin: APC, confirm: true });
ok("confirm:true 才放行", confirmed.ok === true, JSON.stringify(confirmed).slice(0, 200));
ok("放行后确实执行了（有标记文件）", existsSync(MARK) && /script upload/.test(readFileSync(MARK, "utf8")));
rmSync(MARK, { force: true });

const tok = await runApc(["profile", "add", "local", "--token", "bxc_secret"], { bin: APC }).catch((e) => ({ thrown: String(e.message) }));
ok("拒绝代传 --token", /token/i.test(String(tok.thrown || tok.error || "")), JSON.stringify(tok).slice(0, 200));
ok("拒绝时没有执行", !existsSync(MARK));

const bad = await runApc(["rm", "-rf", "/"], { bin: APC }).catch((e) => ({ thrown: String(e.message) }));
ok("白名单外命令被拒", /不认识/.test(String(bad.thrown || bad.error || "")), JSON.stringify(bad).slice(0, 200));

const empty = await runApc([], { bin: APC }).catch((e) => ({ thrown: String(e.message) }));
ok("空参数给出用法", /没给命令/.test(String(empty.thrown || "")));

/* --- 3. apc 探测 --- */
const installed = await probeApc(APC);
ok("probeApc 读到版本", installed.installed === true && installed.version === "0.7.0", JSON.stringify(installed));
const missing = await probeApc("definitely-not-a-real-binary-xyz");
ok("没装时说明未安装", missing.installed === false && missing.reason === "未安装", JSON.stringify(missing));

/* --- 4. Creator 探测：用夹具复刻"3127 → 3125 登录"的跳转链 --- */
const login = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<title>玩家登录</title>"); });
const creator = http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(307, { Location: "/projects" }); return res.end(); }
  if (req.url.startsWith("/projects")) { res.writeHead(307, { Location: `http://127.0.0.1:${login.address().port}/?source=creator` }); return res.end(); }
  res.writeHead(404).end();
});
await new Promise((r) => creator.listen(0, "127.0.0.1", r));
await new Promise((r) => login.listen(0, "127.0.0.1", r));
const cp = creator.address().port;

const unauth = await probeCreator(`127.0.0.1:${cp}`);
ok("跟着跳转认出未认证", unauth.reachable === true && unauth.state === "unauthenticated", JSON.stringify(unauth));
ok("未认证时给出配 Profile 的指引", /apc profile add/.test(unauth.hint || ""), unauth.hint);
ok("跳转链路被记录下来", (unauth.hops || []).length >= 2, JSON.stringify(unauth.hops));

const dead = await probeCreator("127.0.0.1:1");
ok("端口没开时报 down", dead.reachable === false && dead.state === "down", JSON.stringify(dead));

creator.close(); login.close();

/* --- 5. 通过 MCP 端到端跑一遍引擎层 --- */
async function freePort() {
  for (let p = 25500; p < 25700; p++) {
    const s = await import("node:net").then((n) => n.createServer());
    const used = await new Promise((r) => s.once("error", () => r(true)).listen(p, "127.0.0.1", () => { s.close(); r(false); }));
    if (!used) return p;
  }
  throw new Error("没空端口");
}
const port = await freePort();
const child = spawn(process.execPath, [join(ROOT, "mcp", "server.mjs"), "--port", String(port), "--project", join(ROOT, "test", "fixtures", "project"), "--no-plugin", "--apc", APC], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(port), FAKE_APC_MARK: MARK } });
let log = "";
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break; } catch { } await sleep(60); }

const sid = crypto.randomBytes(6).toString("hex");
const pending = new Map();
const es = new AbortController();
const sres = await fetch(`http://127.0.0.1:${port}/ap-mcp`, { headers: { Accept: "text/event-stream" }, signal: es.signal });
let msgUrl = null;
const reader = sres.body.getReader();
const dec = new TextDecoder();
let buf = "";
(async () => {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n"); buf = frames.pop();
    for (const f of frames) {
      let ev = "message"; const d = [];
      for (const line of f.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) d.push(line.slice(5).replace(/^ /, ""));
      }
      if (ev === "endpoint") msgUrl = `http://127.0.0.1:${port}${d.join("")}`;
      else if (ev === "message") { try { const m = JSON.parse(d.join("")); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } } catch { } }
    }
  }
})();
for (let i = 0; i < 100 && !msgUrl; i++) await sleep(25);
const rpc = async (method, params) => {
  const id = crypto.randomUUID();
  const w = new Promise((r) => pending.set(id, r));
  await fetch(msgUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  return w;
};
const text = (r) => (r?.content || []).map((c) => c.text).join("\n");
const call = (name, args) => rpc("tools/call", { name, arguments: args || {} }).then((m) => m.result);
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
const tools = await rpc("tools/list", {});
const names = tools.result.tools.map((t) => t.name);

ok("MCP 清单里有引擎工具", ["engine_status", "engine_projects", "engine_script_get", "engine_storage_get", "engine_runtime_status", "engine_run"].every((n) => names.includes(n)), names.filter((n) => n.startsWith("engine_")).join(","));
const stRaw = text(await call("engine_status", {}));
let st = {}; try { st = JSON.parse(stRaw); } catch { ok("engine_status 返回的是 JSON", false, stRaw.slice(0, 300)); }
ok("engine_status 报 apc 版本", st.apc?.installed === true && st.apc.version === "0.7.0", JSON.stringify(st.apc));
const pr = JSON.parse(text(await call("engine_projects", {})));
ok("engine_projects 走只读通道拿到数据", pr.ok === true && pr.data?.count === 1, JSON.stringify(pr).slice(0, 200));
const gate = await call("engine_run", { args: ["storage", "delete", "player", "k"] });
const gateMsg = { isError: gate.isError, text: text(gate) };
ok("MCP 侧同样挡住写命令", gateMsg.isError === true && /confirm/.test(gateMsg.text), gateMsg.text.slice(0, 200));
ok("MCP 侧被挡的写命令没执行", !existsSync(MARK));
rmSync(MARK, { force: true });
es.abort(); child.kill();

console.log(`\nengine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
