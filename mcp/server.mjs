#!/usr/bin/env node
/**
 * server.mjs — ArenaPro 兼容的 MCP 服务（独立进程）。
 *
 * 默认端口 **25315**、路径 `/ap-mcp`，和官方 ArenaPro 插件的 MCP 一致，
 * 所以已经按官方文档配好 `.vscode/mcp.json` 的客户端**一个字都不用改**就能接上：
 *
 *   { "servers": { "ArenaPro-MCP": { "type": "sse", "url": "http://localhost:25315/ap-mcp" } } }
 *
 * 它自己不存任何东西，全部转发给编辑器（默认 http://127.0.0.1:5180）。
 * 零第三方依赖：MCP 的 SSE 传输就是 text/event-stream + JSON-RPC 2.0。
 *
 *   node mcp/server.mjs [--port 25315] [--editor http://127.0.0.1:5180] [--host 127.0.0.1]
 *
 * 端口被占时**明确报错并说明怎么办**，不会静默换端口——
 * IDE 里配的是 25315，静默挪到别的端口等于让客户端连一个不存在的地方。
 */
import http from "node:http";
import crypto from "node:crypto";
import { TOOLS, UNSUPPORTED, toolDefs } from "./tools.mjs";

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(flag("port", process.env.PORT || 25315));
const HOST = flag("host", process.env.HOST || "127.0.0.1");
const EDITOR = String(flag("editor", process.env.DAO3_BASE || "http://127.0.0.1:5180")).replace(/\/+$/, "");
const VERSION = "1.0.0";
const PROTOCOL_FALLBACK = "2024-11-05";

/* ------------------------------ 对编辑器的 HTTP 客户端 ------------------------------ */
async function getJson(p) {
  const r = await fetch(EDITOR + p);
  if (!r.ok) throw new Error(`编辑器 ${p} → HTTP ${r.status}`);
  return await r.json();
}
async function readWorld(id) {
  try {
    const r = await fetch(`${EDITOR}/api/world/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function writeWorld(id, payload) {
  try {
    const r = await fetch(`${EDITOR}/api/world/${encodeURIComponent(id)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!r.ok) return false;
    return true;
  } catch { return false; }
}
async function postAsset(id, rel, content) {
  try {
    const r = await fetch(`${EDITOR}/api/world/${encodeURIComponent(id)}/asset?path=${encodeURIComponent(rel)}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: content,
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, ...j } : { ok: false, error: j.error || `HTTP ${r.status}` };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

const ctx = { editor: EDITOR, version: VERSION, getJson, readWorld, writeWorld, postAsset };

/* ------------------------------ SSE 会话与 JSON-RPC ------------------------------ */
const sessions = new Map();   // sid -> res

const writable = (res) => res && res.writableEnded !== true && res.destroyed !== true;

function push(sid, payload) {
  const res = sessions.get(sid);
  if (!res || !writable(res)) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

/**
 * endpoint 帧的 data 按 MCP 规格是**纯文本 URL**，不是 JSON。
 * 多包一层引号会让客户端拼出 `http://host"/ap-mcp/messages?sid=…"` 这种非法 URL，
 * 结果是任何真实 MCP 客户端都连不上——而自己写的测试客户端如果跟着错，本地全绿、外面全黑。
 */
function sseRaw(res, event, data) {
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}

async function callTool(name, args) {
  if (UNSUPPORTED[name]) return { content: [{ type: "text", text: `不支持：${UNSUPPORTED[name]}` }], isError: true };
  const t = TOOLS[name];
  if (!t) return { content: [{ type: "text", text: `未知工具 ${name}` }], isError: true };
  const missing = t.needs.filter((k) => args[k] === undefined || args[k] === "");
  if (missing.length) return { content: [{ type: "text", text: `缺少参数：${missing.join(", ")}` }], isError: true };
  try {
    const r = await t.run(ctx, args);
    const text = typeof r === "string" ? r : (r && r.text) || "";
    return { content: [{ type: "text", text }], isError: !!(r && r.isError) };
  } catch (e) {
    return { content: [{ type: "text", text: `工具执行失败：${(e && e.message) || e}` }], isError: true };
  }
}

function handleRpc(sid, msg) {
  const send = (p) => push(sid, p);
  const id = msg.id;
  switch (msg.method) {
    case "initialize":
      return send({ jsonrpc: "2.0", id, result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || PROTOCOL_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: { name: "dao3-editor-skill (ArenaPro-compatible)", version: VERSION },
      } });
    case "ping": return send({ jsonrpc: "2.0", id, result: {} });
    case "tools/list": return send({ jsonrpc: "2.0", id, result: { tools: toolDefs() } });
    case "tools/call":
      return callTool(msg.params.name, msg.params.arguments || {}).then((r) => send({ jsonrpc: "2.0", id, result: r }));
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
      if (Array.isArray(msg)) msg.forEach((m) => handleRpc(sid, m));
      else handleRpc(sid, msg);
    });
    return;
  }

  // 发现端点：不走 MCP 协议也能看到本机支持/不支持哪些工具。
  // 排查"AI 说接上了但调不动"时这是第一站。
  if (u.pathname === "/api/mcp/tools" && req.method === "GET") {
    return json(res, 200, {
      endpoint: "/ap-mcp", transport: "sse", port: PORT,
      officialContract: "ArenaPro 插件 MCP（官方默认同为 http://localhost:25315/ap-mcp）",
      editor: EDITOR, supported: Object.keys(TOOLS), unsupported: UNSUPPORTED,
    });
  }

  if (u.pathname === "/health" && req.method === "GET") {
    let editor = { reachable: false };
    try { editor = { reachable: true, ...(await getJson("/api/whoami")) }; } catch (e) { editor = { reachable: false, error: String(e.message || e) }; }
    return json(res, 200, { ok: editor.reachable, mcp: `http://${HOST}:${PORT}/ap-mcp`, editor, sessions: sessions.size });
  }

  json(res, 404, { error: "not found", endpoints: ["/ap-mcp (SSE)", "/ap-mcp/messages (POST)", "/api/mcp/tools", "/health"] });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。`);
    console.error(`如果那是官方 ArenaPro 插件的 MCP，两者会抢同一个端口——把本工具换到别的端口，`);
    console.error(`并同步改 IDE 里的 URL：node mcp/server.mjs --port 25316`);
    console.error(`查谁占着：lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
  } else console.error("启动失败：", e.message || e);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  console.log(`ArenaPro 兼容 MCP 已启动  http://${HOST}:${PORT}/ap-mcp`);
  console.log(`转发到编辑器            ${EDITOR}`);
  let who = null;
  try { who = await getJson("/api/whoami"); } catch { /* 下面统一提示 */ }
  if (who) console.log(`编辑器在线              ${who.app} ${who.version}`);
  else console.log(`⚠ 连不上 ${EDITOR}。先起编辑器：cd <编辑器仓库> && node start.mjs --no-open --port=5180 --host=127.0.0.1`);
  console.log(`工具                    ${Object.keys(TOOLS).length} 个可用 · ${Object.keys(UNSUPPORTED).length} 个明说不支持`);
});
