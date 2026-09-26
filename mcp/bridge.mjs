/**
 * bridge.mjs — 官方 ArenaPro 插件 MCP 的**客户端**。
 *
 * 官方插件在 http://localhost:25315/ap-mcp 上开一个 SSE 端点，暴露 24 个工具。
 * 本包是它的客户端，不是它的替代：连得上就原样透传（工具名、参数、返回都不加工），
 * 连不上就明说没检测到插件，并给出该装什么、该开什么——绝不假装成功。
 *
 * 传输是 MCP 的 HTTP+SSE（legacy）那一套：
 *   GET  /ap-mcp                     → event: endpoint，data 是**纯文本**的 messages URL
 *   POST <那个 URL> + JSON-RPC 2.0   → 202，真正的回包从 SSE 流里按 id 匹配
 *
 * 零第三方依赖。
 */
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15000;

/** 把一帧 SSE 文本解成 {event,data}；多条 data: 行按规格用 \n 连接。 */
export function parseSseFrame(frame) {
  let event = "message";
  const dataLines = [];
  for (const raw of frame.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const field = line.slice(0, i);
    const value = line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  return { event, data: dataLines.join("\n") };
}

export class SseMcpClient {
  /**
   * @param {string} url  形如 http://127.0.0.1:25315/ap-mcp
   * @param {object} [opt]
   */
  constructor(url, opt = {}) {
    this.url = url;
    this.timeoutMs = opt.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.serverInfo = null;
    this.tools = [];
    this._pending = new Map();
    this._abort = new AbortController();
    this._endpoint = null;
    this._ready = null;
    this._closed = false;
  }

  /** 建立 SSE 流并等 endpoint 帧。重复调用返回同一个 promise。 */
  start() {
    this._ready ||= this._connect();
    return this._ready;
  }

  async _connect() {
    const res = await fetch(this.url, {
      headers: { Accept: "text/event-stream" },
      signal: this._abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream")) throw new Error(`不是 SSE 流（content-type: ${ct || "未知"}）`);

    await new Promise((resolve, reject) => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error(`等 endpoint 帧超时（${this.timeoutMs}ms）`)); }
      }, this.timeoutMs);

      const frameDone = () => {
        const frames = buf.split(/\r?\n\r?\n/);
        buf = frames.pop();
        for (const f of frames) {
          if (!f.trim()) continue;
          const { event, data } = parseSseFrame(f);
          if (event === "endpoint" && data) {
            this._endpoint = new URL(data, this.url).toString();
            if (!settled) { settled = true; clearTimeout(timer); resolve(); }
          } else if (event === "message" && data) {
            this._dispatch(data);
          }
        }
      };

      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            frameDone();
          }
          if (!settled) { settled = true; clearTimeout(timer); reject(new Error("SSE 流已关闭")); }
        } catch (e) {
          if (!settled) { settled = true; clearTimeout(timer); reject(e); }
        }
      })();
    });
    return this;
  }

  _dispatch(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const list = Array.isArray(msg) ? msg : [msg];
    for (const m of list) {
      if (m.method && m.id === undefined) continue;          // 通知，无需回
      const p = this._pending.get(m.id);
      if (!p) continue;
      this._pending.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(m);
    }
  }

  async rpc(method, params) {
    await this.start();
    const id = randomUUID();
    const body = { jsonrpc: "2.0", id, method };
    if (params !== undefined) body.params = params;

    const waiter = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.delete(id)) reject(new Error(`${method} 超时（${this.timeoutMs}ms）`));
      }, this.timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
    });

    const r = await fetch(this._endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    }).catch((e) => {
      clearTimeout(this._pending.get(id)?.timer);
      this._pending.delete(id);
      throw new Error(`POST ${this._endpoint} 失败：${e.message || e}`);
    });

    // 规格上 POST 只回 202、结果走 SSE；但有的实现直接在 POST 上回 JSON。两种都吃。
    const ct = r.headers.get("content-type") || "";
    if (r.status >= 400) {
      clearTimeout(this._pending.get(id)?.timer);
      this._pending.delete(id);
      throw new Error(`POST → HTTP ${r.status}`);
    }
    if (ct.includes("application/json")) {
      const j = await r.json().catch(() => null);
      if (j && j.id !== undefined) {
        clearTimeout(this._pending.get(id)?.timer);
        this._pending.delete(id);
        return j;
      }
    }
    return waiter;
  }

  /** 握手 + 拉官方工具清单。返回 { serverInfo, tools }。 */
  async discover() {
    const init = await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "arenapro-kit", version: "0.1.0" },
    });
    if (init.error) throw new Error(`initialize 被拒：${init.error.message}`);
    this.serverInfo = init.result?.serverInfo || null;
    const tl = await this.rpc("tools/list", {});
    if (tl.error) throw new Error(`tools/list 被拒：${tl.error.message}`);
    this.tools = tl.result?.tools || [];
    return { serverInfo: this.serverInfo, tools: this.tools };
  }

  async callTool(name, args) {
    const r = await this.rpc("tools/call", { name, arguments: args || {} });
    if (r.error) return { content: [{ type: "text", text: `插件返回错误：${r.error.message}` }], isError: true };
    return r.result;
  }

  close() {
    this._closed = true;
    for (const p of this._pending.values()) clearTimeout(p.timer);
    this._pending.clear();
    this._abort.abort();
  }
}

/** 探一下官方插件在不在，不做长期连接。 */
export async function probe(url, timeoutMs = 2500) {
  const c = new SseMcpClient(url, { timeoutMs });
  try {
    const d = await c.discover();
    return { ok: true, url, ...d };
  } catch (e) {
    return { ok: false, url, error: String(e.message || e) };
  } finally {
    c.close();
  }
}
