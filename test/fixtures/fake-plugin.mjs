#!/usr/bin/env node
/**
 * fake-plugin.mjs — 测试夹具，不是官方实现。
 *
 * 官方 ArenaPro 插件没装在这台机器上，"能不能透传"就没法测。
 * 这个夹具按官方文档的形状开一个 SSE MCP 端点（endpoint 帧是纯文本 URL），
 * 只提供几个工具名与官方一致的工具，用来验证 arenapro-kit 的转发与优先级：
 * **插件提供的名字必须以插件为准**，不能被本包的"不支持"盖掉。
 */
import http from "node:http";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const PORT = Number(argv.includes("--port") ? argv[argv.indexOf("--port") + 1] : 0);
const HOST = "127.0.0.1";

const TOOLS = [
  { name: "file_upLoad", description: "上传 JS 文件（夹具）", inputSchema: { type: "object", properties: {} } },
  { name: "map_showMap", description: "显示地图创作端（夹具）", inputSchema: { type: "object", properties: {} } },
  { name: "component_showComponentStats", description: "组件统计（夹具）", inputSchema: { type: "object", properties: {} } },
  { name: "plugin_boom", description: "总是失败，用来验证错误如实传回", inputSchema: { type: "object", properties: {} } },
];

const sessions = new Map();
const send = (sid, p) => {
  const res = sessions.get(sid);
  if (res && !res.writableEnded) res.write(`data: ${JSON.stringify(p)}\n\n`);
};

function rpc(sid, msg) {
  const { id } = msg;
  switch (msg.method) {
    case "initialize":
      return send(sid, { jsonrpc: "2.0", id, result: {
        protocolVersion: "2024-11-05", capabilities: { tools: {} },
        serverInfo: { name: "fake-arenapro-plugin", version: "0.0.0-test" },
      } });
    case "tools/list": return send(sid, { jsonrpc: "2.0", id, result: { tools: TOOLS } });
    case "tools/call": {
      const n = msg.params.name;
      if (n === "plugin_boom") return send(sid, { jsonrpc: "2.0", id, error: { code: -32000, message: "夹具故意失败" } });
      return send(sid, { jsonrpc: "2.0", id, result: {
        content: [{ type: "text", text: `插件收到了 ${n}：${JSON.stringify(msg.params.arguments || {})}` }],
      } });
    }
    default: return send(sid, { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === "/ap-mcp" && req.method === "GET") {
    const sid = crypto.randomBytes(6).toString("hex");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("retry: 3000\n\n");
    sessions.set(sid, res);
    res.write(`event: endpoint\ndata: /ap-mcp/messages?sid=${sid}\n\n`);
    req.on("close", () => sessions.delete(sid));
    return;
  }
  if (u.pathname === "/ap-mcp/messages" && req.method === "POST") {
    const sid = u.searchParams.get("sid");
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.writeHead(202).end();
      if (!sessions.has(sid)) return;
      let msg; try { msg = JSON.parse(body); } catch { return; }
      (Array.isArray(msg) ? msg : [msg]).forEach((m) => rpc(sid, m));
    });
    return;
  }
  if (u.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, fixture: true, tools: TOOLS.map((t) => t.name) }));
  }
  res.writeHead(404).end();
});

server.listen(PORT, HOST, () => console.log(`fake plugin 已启动 http://${HOST}:${PORT}/ap-mcp`));
