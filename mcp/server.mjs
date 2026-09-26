#!/usr/bin/env node
/**
 * server.mjs — arenapro-kit 的 MCP 端点：**官方插件的客户端 + 本地工程层**。
 *
 * 默认端口 **25316**，故意让开官方 ArenaPro 插件的 25315。
 * 本包不冒充插件：能连上就把它的 24 个工具原样透传，连不上就明说。
 *
 *   node mcp/server.mjs [--port 25316] [--project <ArenaPro 工程目录>]
 *                       [--plugin http://127.0.0.1:25315/ap-mcp] [--no-plugin]
 *
 * IDE 侧（官方插件已在跑时，两个 server 并存；没在跑时只挂这一个也行）：
 *   { "servers": { "arenapro-kit": { "type": "sse", "url": "http://localhost:25316/ap-mcp" } } }
 *
 * 路由规则：插件提供的名字优先——它能让 AI 真上传脚本，我这边的"不支持"就不该挡在前面。
 */
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLS, REFUSED, toolDefs, callLocal } from "./tools.mjs";
import { SseMcpClient } from "./bridge.mjs";

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (k) => argv.includes("--" + k);

const PORT = Number(flag("port", process.env.PORT || 25316));
const HOST = flag("host", process.env.HOST || "127.0.0.1");
const PROJECT = flag("project", process.env.ARENA_PROJECT || process.cwd());
const PLUGIN_URL = has("no-plugin") ? null : String(flag("plugin", process.env.ARENA_PLUGIN || "http://127.0.0.1:25315/ap-mcp"));
// 版本号只有一个来源：package.json。写死在两处早晚对不上（介绍页也读它）。
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const PROTOCOL_FALLBACK = "2024-11-05";

if (PLUGIN_URL && !/:(25315)\b/.test(PLUGIN_URL) && PORT === 25315) {
  console.log("提示：你把本服务也配在 25315——那正是官方插件的端口，两边会互抢。");
}

/* ------------------------------- 插件桥 ------------------------------- */

const ctx = { projectRoot: PROJECT };
let bridge = null;                 // SseMcpClient | null
let pluginTools = [];              // [{name, description, inputSchema}]
let pluginError = null;
let nextProbeAt = 0;

async function refreshPlugin(force) {
  if (!PLUGIN_URL) return;
  if (!force && Date.now() < nextProbeAt) return;
  nextProbeAt = Date.now() + 5000;                 // 5 秒内不反复探，避免调用风暴
  try {
    if (bridge) bridge.close();
    bridge = new SseMcpClient(PLUGIN_URL, { timeoutMs: 4000 });
    const d = await bridge.discover();
    pluginTools = d.tools || [];
    pluginError = null;
    bridgeInfo = d.serverInfo || null;
  } catch (e) {
    if (bridge) bridge.close();
    bridge = null;
    pluginTools = [];
    pluginError = String(e.message || e);
  }
}
let bridgeInfo = null;

const pluginNames = () => new Set(pluginTools.map((t) => t.name));

/* ------------------------------ SSE 会话 ------------------------------ */

const sessions = new Map();
const writable = (res) => res && res.writableEnded !== true && res.destroyed !== true;
const push = (sid, payload) => {
  const res = sessions.get(sid);
  if (!res || !writable(res)) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
};

/** endpoint 帧的 data 按 MCP 规格是**纯文本 URL**，不是 JSON。 */
const sseRaw = (res, event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`);

function defs() {
  const own = toolDefs();
  const fromPlugin = pluginNames();
  // 插件在线时：它提供的名字一律以它为准，本包的"不支持"条目不再出现，
  // 本地工具里与它重名的也不覆盖它。
  const keep = own.filter((d) => !fromPlugin.has(d.name) || TOOLS[d.name]);
  return [...pluginTools.map((t) => ({ ...t, source: "arenapro-plugin" })), ...keep];
}

async function callTool(name, args) {
  if (pluginNames().has(name) && bridge) {
    try {
      return await bridge.callTool(name, args);
    } catch (e) {
      await refreshPlugin(true);
      return { content: [{ type: "text", text: `转发给官方插件失败：${e.message || e}` }], isError: true };
    }
  }
  if (TOOLS[name]) return callLocal(name, args, ctx);
  if (REFUSED[name]) {
    const why = pluginError ? `${REFUSED[name]}\n（另：官方插件没连上——${PLUGIN_URL}：${pluginError}）` : REFUSED[name];
    return { content: [{ type: "text", text: `不支持：${why}` }], isError: true };
  }
  return { content: [{ type: "text", text: `未知工具 ${name}` }], isError: true };
}

async function handleRpc(sid, msg) {
  const send = (p) => push(sid, p);
  const id = msg.id;
  switch (msg.method) {
    case "initialize":
      return send({ jsonrpc: "2.0", id, result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || PROTOCOL_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: { name: "arenapro-kit", version: VERSION },
      } });
    case "ping": return send({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      await refreshPlugin(false);
      return send({ jsonrpc: "2.0", id, result: { tools: defs() } });
    case "tools/call":
      return send({ jsonrpc: "2.0", id, result: await callTool(msg.params.name, msg.params.arguments || {}) });
    default:
      if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
}

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj, null, 2));
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (u.pathname === "/ap-mcp" && req.method === "GET") {
    const sid = crypto.randomBytes(8).toString("hex");
    res.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive", "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    sessions.set(sid, res);
    sseRaw(res, "endpoint", `/ap-mcp/messages?sid=${sid}`);
    req.on("close", () => sessions.delete(sid));
    return;
  }

  if (u.pathname === "/ap-mcp/messages" && req.method === "POST") {
    const sid = u.searchParams.get("sid");
    if (!sessions.has(sid)) return json(res, 404, { error: "unknown or closed session" });
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 8 * 1024 * 1024) req.destroy(); });
    req.on("end", () => {
      res.writeHead(202).end();
      let msg; try { msg = JSON.parse(body); } catch { return; }
      (Array.isArray(msg) ? msg : [msg]).forEach((m) => handleRpc(sid, m));
    });
    return;
  }

  // 发现端点：不走 MCP 协议也能看清"哪些是透传、哪些本地能做、哪些明确不做"。
  if (u.pathname === "/api/mcp/tools" && req.method === "GET") {
    await refreshPlugin(false);
    return json(res, 200, {
      endpoint: "/ap-mcp", transport: "sse", port: PORT, projectRoot: PROJECT,
      plugin: PLUGIN_URL ? { url: PLUGIN_URL, online: !!bridge, error: pluginError, tools: pluginTools.map((t) => t.name) } : { enabled: false },
      local: Object.keys(TOOLS),
      refused: Object.fromEntries(Object.entries(REFUSED).filter(([n]) => !pluginNames().has(n))),
    });
  }

  if (u.pathname === "/health" && req.method === "GET") {
    await refreshPlugin(false);
    const { findProject } = await import("./project.mjs");
    return json(res, 200, {
      ok: true,
      mcp: `http://${HOST}:${PORT}/ap-mcp`,
      plugin: PLUGIN_URL ? { url: PLUGIN_URL, online: !!bridge, serverInfo: bridgeInfo, tools: pluginTools.length, error: pluginError } : { enabled: false },
      project: findProject(PROJECT) ? findProject(PROJECT) : { isProject: false, cwd: PROJECT },
      local: Object.keys(TOOLS).length,
      refused: Object.keys(REFUSED).length,
      sessions: sessions.size,
    });
  }

  json(res, 404, { error: "not found", endpoints: ["/ap-mcp (SSE)", "/ap-mcp/messages (POST)", "/api/mcp/tools", "/health"] });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。查谁占着：lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    if (PORT === 25315) console.error("注意 25315 是官方 ArenaPro 插件的端口，本包默认用 25316，不建议抢它。");
  } else console.error("启动失败：", e.message || e);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  await refreshPlugin(true);
  console.log(`arenapro-kit MCP 已启动     http://${HOST}:${PORT}/ap-mcp`);
  console.log(`工程目录                  ${PROJECT}`);
  if (!PLUGIN_URL) console.log(`官方插件                  已用 --no-plugin 关掉探测`);
  else if (bridge) console.log(`官方插件在线              ${PLUGIN_URL} · 透传 ${pluginTools.length} 个工具${bridgeInfo?.name ? ` · ${bridgeInfo.name}` : ""}`);
  else console.log(`未检测到官方插件          ${PLUGIN_URL}（${pluginError}）\n                          官方工具会返回"不支持 + 该跑什么命令"，本地工程层照常可用`);
  console.log(`本包工具                  本地 ${Object.keys(TOOLS).length} 个 · 明确不做 ${Object.keys(REFUSED).length} 个`);
});

process.on("SIGINT", () => { if (bridge) bridge.close(); process.exit(0); });
