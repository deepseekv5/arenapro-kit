/**
 * kit.test.mjs — arenapro-kit 的契约测试。
 *
 * 自己手写了一个最小 MCP 客户端（SSE + JSON-RPC），**不 import 被测模块的 bridge.mjs**——
 * 自己测自己等于自己给自己打分：上一版就是因为测试客户端和被测实现把 endpoint 帧
 * 一起按错的形状解析，本地全绿、真实客户端全连不上。
 *
 * 还起了一个**假插件**（test/fixtures/fake-plugin.mjs）来验证透传：
 * 官方插件本机没装时，"能不能转发"这件事也得有地方测。它只是夹具，不代表官方实现。
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import crypto from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FIXTURE = join(HERE, "fixtures", "project");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 400) : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  for (let p = 25400; p < 25600; p++) {
    const s = await import("node:net").then((n) => n.createServer());
    const used = await new Promise((r) => s.once("error", () => r(true)).listen(p, "127.0.0.1", () => { s.close(); r(false); }));
    if (!used) return p;
  }
  throw new Error("找不到空端口");
}

/* ------------------------- 手写的最小 MCP 客户端 ------------------------- */

function sseClient(url) {
  const ac = new AbortController();
  const pending = new Map();
  let endpoint = null;
  let ready = null;

  const start = () => (ready ||= (async () => {
    const res = await fetch(url, { headers: { Accept: "text/event-stream" }, signal: ac.signal });
    if (!res.ok) throw new Error(`SSE HTTP ${res.status}`);
    const dec = new TextDecoder();
    const reader = res.body.getReader();      // 只取一次：每轮 getReader() 会撞上 "stream is locked"
    let buf = "";
    (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop();
        for (const f of frames) {
          let ev = "message";
          const data = [];
          for (const line of f.split("\n")) {
            if (line.startsWith("event:")) ev = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          }
          if (ev === "endpoint") endpoint = new URL(data.join("\n"), url).toString();
          else if (ev === "message") {
            try {
              const m = JSON.parse(data.join("\n"));
              const p = pending.get(m.id);
              if (p) { pending.delete(m.id); clearTimeout(p.t); p.resolve(m); }
            } catch { /* 非 JSON 帧忽略 */ }
          }
        }
      }
    })();
    for (let i = 0; i < 200 && !endpoint; i++) await sleep(25);
    if (!endpoint) throw new Error("没等到 endpoint 帧");
    return true;
  })());

  const rpc = async (method, params) => {
    await start();
    const id = crypto.randomUUID();
    const w = new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 8000);
      pending.set(id, { resolve, reject, t });
    });
    const r = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (r.status >= 400) throw new Error(`POST → ${r.status}`);
    return w;
  };
  return {
    rpc,
    async tools() { return (await rpc("tools/list", {})).result.tools; },
    async call(name, args) { return (await rpc("tools/call", { name, arguments: args || {} })).result; },
    text: (r) => (r?.content || []).map((c) => c.text).join("\n"),
    close: () => ac.abort(),
  };
}

/* ------------------------------ 起进程 ------------------------------ */

async function serve(args, tag) {
  const p = await freePort();
  const child = spawn(process.execPath, args.map((a) => a.replace("{port}", String(p))), {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(p) },
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const port = p;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break; } catch { await sleep(50); }
    await sleep(50);
  }
  return { port, url: `http://127.0.0.1:${port}/ap-mcp`, child, log: () => out, tag };
}

const plugin = await serve([join(ROOT, "test", "fixtures", "fake-plugin.mjs"), "--port", "{port}"], "fake-plugin");
const kit = await serve([
  join(ROOT, "mcp", "server.mjs"), "--port", "{port}", "--project", FIXTURE,
  "--plugin", `${plugin.url}`,
], "kit");
const cli = sseClient(kit.url);

try {
  await cli.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  const tools = await cli.tools();
  const names = tools.map((t) => t.name);

  /* --- 1. 工具清单 --- */
  ok("tools/list 有内容", tools.length > 20, `只有 ${tools.length}`);
  ok("本地工具全部在册", ["project_info", "script_read", "script_write", "api_search", "api_class", "dts_check", "env_show", "apc_plan", "build_status", "script_list"].every((n) => names.includes(n)));
  ok("透传：假插件的工具在清单里", names.includes("file_upLoad") && names.includes("map_showMap"));
  ok("透传优先：假插件提供的 file_upLoad 不再被标为不支持",
    !/本包不执行/.test((tools.find((t) => t.name === "file_upLoad") || {}).description || ""),
    (tools.find((t) => t.name === "file_upLoad") || {}).description);
  ok("插件没提供的名字仍保留「本包不执行」", /本包不执行/.test((tools.find((t) => t.name === "getMapStatList") || {}).description || ""));
  ok("每个工具有 inputSchema", tools.every((t) => t.inputSchema && t.inputSchema.type === "object"));

  /* --- 2. 转发 --- */
  const fwd = await cli.call("map_showMap", { hello: "world" });
  ok("调用被转发给插件", /插件收到了/.test(cli.text(fwd)) && /hello/.test(cli.text(fwd)), cli.text(fwd));
  ok("转发不改写返回", fwd.isError !== true);
  const boom = await cli.call("plugin_boom", {});
  ok("插件报错如实传回 isError", boom.isError === true, cli.text(boom));

  /* --- 3. 拒绝面 --- */
  const refused = await cli.call("getMapStatList", {});
  ok("出网的工具被明确拒绝", refused.isError === true && /不出网|不读凭据|要出网/.test(cli.text(refused)), cli.text(refused));
  ok("拒绝文本里不出现凭据样串", !/supersecret|Bearer |eyJ/.test(cli.text(refused)), cli.text(refused));
  const unknown = await cli.call("no_such_tool_xyz", {});
  ok("未知工具返回 isError 而不是崩", unknown.isError === true && /未知工具/.test(cli.text(unknown)));

  /* --- 4. 工程层 --- */
  const info = JSON.parse(cli.text(await cli.call("project_info", { root: join(FIXTURE, "server/src/App.ts") })));
  ok("认出工程根", info.root && info.root.endsWith("fixtures/project"), info.root);
  ok("解出 bundle 配置", info.bundles.bundles?.[0]?.name === "bundle" && info.bundles.bundles[0].server === "App.ts", JSON.stringify(info.bundles));
  ok("d.ts 两侧都在", Object.keys(info.types.sources).length === 2 && info.types.missing.length === 0, JSON.stringify(info.types));
  ok("API 面统计非零", info.apiSurface.classes >= 6 && info.apiSurface.members >= 15, JSON.stringify(info.apiSurface));
  ok("脚本清单数得对", info.scripts.server === 1 && info.scripts.client === 1, JSON.stringify(info.scripts));

  /* --- 5. env 脱敏 --- */
  const env = cli.text(await cli.call("env_show", { root: FIXTURE }));
  ok("env 显示永久地图 ID 与 Profile", /map-fixture123/.test(env) && /local/.test(env), env.slice(0, 240));
  ok("旧版 0.5.x 键也认", /100005475/.test(env));
  ok("env 不泄露任何凭据值", !/supersecret/.test(env), env.slice(0, 240));
  ok("违规写进 .env 的凭据被点名（只报键名）", /credentialsFound[\s\S]*VITE_DAO3_AUTH/.test(env) && /BOX_CREATOR_TOKEN/.test(env), env.slice(0, 300));
  const envDev = cli.text(await cli.call("env_show", { root: FIXTURE, mode: "dev" }));
  ok("--env dev 读的是 .env.dev 且不回退", /map-devonly456/.test(envDev) && !/map-fixture123/.test(envDev), envDev);
  ok("dev 档同样不泄露凭据", !/supersecret|dev-secret/.test(envDev));

  /* --- 6. API 规范检索（解析器的回归点） --- */
  const s = JSON.parse(cli.text(await cli.call("api_search", { root: FIXTURE, query: "广播" })));
  ok("中文说明能搜到", s.hits.some((h) => h.member === "say"), JSON.stringify(s.hits).slice(0, 200));
  const say = s.hits.find((h) => h.member === "say");
  ok("@zh 单独一行也能取到说明", say && say.zh === "向所有玩家广播一条消息。", say && say.zh);
  ok("@param 后面的第二个 @zh 不会顶掉成员说明", say && !/要广播的文本消息/.test(say.zh), say && say.zh);

  const vec = JSON.parse(cli.text(await cli.call("api_class", { root: FIXTURE, name: "GameVector3" })));
  const vm = Object.keys(vec.members);
  ok("private constructor 被记为成员", vm.includes("constructor"), vm.join(","));
  ok("toString 被记为成员（原型继承曾吃掉它）", vm.includes("toString"), vm.join(","));
  ok("返回值是对象类型的成员不丢", vm.includes("getAxisAngle"), vm.join(","));
  ok("@link 保留", vec.members.getAxisAngle.link.includes("docs.dao3.fun"), vec.members.getAxisAngle.link);

  const world = JSON.parse(cli.text(await cli.call("api_class", { root: FIXTURE, name: "GameWorld" })));
  ok("参数里带内联对象类型的成员不丢", Object.keys(world.members).includes("sound"), Object.keys(world.members).join(","));
  ok("成员数超过 3", Object.keys(world.members).length >= 3);
  const noclass = await cli.call("api_class", { root: FIXTURE, name: "GameNotReal" });
  ok("查不到的类直说没有，并给候选", noclass.isError === true && /官方没有这个名字/.test(cli.text(noclass)), cli.text(noclass));

  /* --- 7. 读写边界 --- */
  const readTxt = cli.text(await cli.call("script_read", { root: FIXTURE, path: "server/src/App.ts" }));
  ok("读文件返回路径与内容", /server\/src\/App\.ts/.test(readTxt) && /world\.say/.test(readTxt), readTxt.slice(0, 120));
  const w = await cli.call("script_write", { root: FIXTURE, path: "server/src/Gen.ts", content: "export const a = 1;\n" });
  ok("写工程内新文件成功", /已创建/.test(cli.text(w)) && existsSync(join(FIXTURE, "server/src/Gen.ts")), cli.text(w));
  const esc = await cli.call("script_write", { root: FIXTURE, path: "../escape.ts", content: "x" });
  ok("路径穿越被明确拒绝", esc.isError === true && /越界|相对路径/.test(cli.text(esc)), cli.text(esc));
  ok("拒绝后没留下文件", !existsSync(resolve(FIXTURE, "..", "escape.ts")));
  const abs = await cli.call("script_read", { root: FIXTURE, path: "/etc/passwd" });
  ok("绝对路径被拒", abs.isError === true, cli.text(abs));
  const typ = await cli.call("script_write", { root: FIXTURE, path: "server/src/x.sh", content: "rm -rf" });
  ok("不允许的文件类型被拒", typ.isError === true && /文件类型/.test(cli.text(typ)), cli.text(typ));
  const stale = await cli.call("script_write", { root: FIXTURE, path: "server/src/Gen.ts", content: "y", ifUnchangedSince: 1 });
  ok("目标被改过时先拒绝", stale.isError === true && /覆盖/.test(cli.text(stale)), cli.text(stale));
  const forced = await cli.call("script_write", { root: FIXTURE, path: "server/src/Gen.ts", content: "z\n", force: true });
  ok("force 才真写", /已覆盖/.test(cli.text(forced)));

  /* --- 8. 其它 --- */
  const dts = JSON.parse(cli.text(await cli.call("dts_check", { root: FIXTURE })));
  ok("dts_check 指出缺 UiIndex", dts.missing.includes("client/UiIndex/index.ts"), JSON.stringify(dts.missing));
  ok("缺的东西给的是 apc 命令", dts.rows.every((x) => !x.exists || /^apc /.test(x.fix)));
  const plan = cli.text(await cli.call("apc_plan", { intent: "upload" }));
  ok("upload 计划是 apc script upload 且没执行", /apc script upload/.test(plan) && !kit.log().includes("exec"), plan);
  const bad = await cli.call("apc_plan", { intent: "rmrf" });
  ok("未知意图被拒", bad.isError === true);
  const noProject = await cli.call("project_info", { root: "/tmp" });
  ok("非工程目录给出建工程指引", noProject.isError === true && /apc project create/.test(cli.text(noProject)), cli.text(noProject));

  const disc = await (await fetch(`http://127.0.0.1:${kit.port}/api/mcp/tools`)).json();
  ok("发现端点报出插件在线", disc.plugin.online === true && disc.plugin.tools.includes("file_upLoad"), JSON.stringify(disc.plugin).slice(0, 200));
  ok("发现端点把拒绝项单列", Object.keys(disc.refused).length > 20);

  /* --- 9. 插件掉线 --- */
  plugin.child.kill();
  await sleep(600);
  const off = await cli.call("map_showMap", {});
  ok("插件没了会如实报错", off.isError === true || /失败|不支持/.test(cli.text(off)), cli.text(off));
  const stillLocal = await cli.call("api_search", { root: FIXTURE, query: "广播" });
  ok("插件掉线不影响本地工具", stillLocal.isError !== true);
} catch (e) {
  fail++;
  console.log("FAIL  跑挂了：" + (e && e.stack || e));
  console.log("--- kit log ---\n" + kit.log().slice(0, 800));
} finally {
  cli.close();
  kit.child.kill();
  plugin.child.kill();
  const { rmSync } = await import("node:fs");
  rmSync(join(FIXTURE, "server/src/Gen.ts"), { force: true });
}

console.log(`\nkit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
