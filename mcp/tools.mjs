/**
 * tools.mjs — ArenaPro 兼容 MCP 的工具表。
 *
 * 官方契约（ArenaPro 插件 MCP）：SSE 传输，默认 http://localhost:25315/ap-mcp，
 * 工具名如 file_mapTool / map_showMap。这里路径与工具名照官方，只换实现。
 *
 * **全部走编辑器的 HTTP API，不读它的文件、不 import 它的模块。**
 * 这是它作为独立仓库的前提：只要编辑器服务在跑就能用，编辑器换版本、换目录、
 * 甚至换成官方桌面版都不影响这一层。顺带把"路径穿越能不能写出资产目录"
 * 这类问题交还给唯一该负责它的地方——服务端自己的那道闸。
 *
 * 一条硬规矩：**做不到的工具直接说不支持，不假装成功。**
 * userCenterTool_*（账号 / Token）依赖神岛线上账号体系，这里没有账号系统，
 * 所以它们出现在 tools/list 里但一律返回明确的"不支持 + 为什么"。
 * 一个会返回假 token 的登录工具，比没有这个工具危险得多。
 */

/* ------------------------------ 知识库缓存 ------------------------------ */
// 规范与方块表从编辑器拉，缓存一次。拉不到时**不缓存空值**——
// 否则编辑器刚重启，这个进程会永久认为"规范里 0 个成员"，checkDts 就变成一台
// 永远说"全部能找到"的机器。
const cache = new Map();
async function cachedJson(ctx, path) {
  if (cache.has(path)) return cache.get(path);
  const v = await ctx.getJson(path).catch(() => null);
  if (v) cache.set(path, v);
  return v;
}

/** api-spec.json 的真实形状：{classes:{类名:{side,kind,d,m:{成员名:{s,d}}}}} */
function eachMember(spec, fn) {
  for (const [cname, cls] of Object.entries((spec && spec.classes) || {})) {
    fn(cname, cls, null);
    for (const [mname, m] of Object.entries((cls && cls.m) || {})) fn(cname, cls, { name: mname, ...m });
  }
}

function searchSpec(spec, query, limit = 10) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [];
  const terms = q.split(/[\s.()、,，]+/).filter(Boolean);
  const hits = [];
  eachMember(spec, (cname, cls, m) => {
    const label = m ? `${cname}.${m.name}` : cname;
    const hay = `${label} ${(m ? m.d : cls.d) || ""} ${(m ? m.s : "") || ""} ${cls.side || ""}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (!t || !hay.includes(t)) continue;
      score += t.length > 3 ? 3 : 2;
      if (label.toLowerCase() === t) score += 8;
      else if (label.toLowerCase().startsWith(t)) score += 3;
    }
    if (score) hits.push({ label, score, sig: m ? m.s : (cls.kind || ""), d: ((m ? m.d : cls.d) || "").replace(/\s+/g, " ").slice(0, 160), side: cls.side || "" });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
    .map((h) => `${h.label}${h.sig ? "  " + h.sig : ""}${h.side ? `  [${h.side}]` : ""}${h.d ? "  — " + h.d : ""}`);
}

const SPEC_PATH = "/data/api-spec.json";
const ATLAS_PATH = "/data/block-atlas.json";

/* ------------------------------ 工具表 ------------------------------ */
/** 每个工具：desc、needs、run(ctx,args) → 字符串 或 {text,isError} */
export const TOOLS = {
  file_mapTool: {
    desc: "地图选择：列出编辑器里全部地图（id、名称、尺寸、体素数、实体数、脚本数）。",
    needs: [],
    async run(ctx) {
      const r = await ctx.getJson("/api/worlds");
      const ws = (r && r.worlds) || [];
      if (!ws.length) return "编辑器里还没有任何地图。用 file_createProject 建一张。";
      return `共 ${ws.length} 张地图：\n` + ws.map((w) =>
        `${w.id}  ${w.name || "(未命名)"}  ${w.shape}  ${w.blockCount}格  实体${w.entities}  脚本${w.scripts}`).join("\n");
    },
  },

  map_showMap: {
    desc: "显示地图创作端：返回该地图的创作端地址与结构摘要。",
    needs: ["mapId"],
    async run(ctx, a) {
      const w = await ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const m = w.meta || {};
      const n = (k) => (Array.isArray(m[k]) ? m[k].length : 0);
      return [`创作端地址：${ctx.editor}/edit/${a.mapId}`,
        `名称：${m.name || "(未命名)"}  尺寸：${(w.shape || []).join("×")}  体素：${(w.data || []).length}`,
        `实体 ${n("entities")}、脚本 ${n("scripts")}、区域 ${n("zones")}、界面节点 ${n("ui")}、商品 ${n("products")}`].join("\n");
    },
  },

  map_playData: {
    desc: "查看游玩数据：返回该图的结构统计与规则。没有线上留存统计可查（见文末说明）。",
    needs: ["mapId"],
    async run(ctx, a) {
      const w = await ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const m = w.meta || {};
      const gr = m.gameRules || {};
      const n = (k) => (Array.isArray(m[k]) ? m[k].length : 0);
      return [`地图 ${a.mapId}（${m.name || "未命名"}）`,
        `体素 ${(w.data || []).length} / 尺寸 ${(w.shape || []).join("×")}`,
        `实体 ${n("entities")}、脚本 ${n("scripts")}、区域 ${n("zones")}、商品 ${n("products")}`,
        `规则 tpm=${gr.tpm ?? 15.625}（官方 64ms/tick → 15.625 tick/秒）`,
        `说明：本地编辑器没有官方服务器的在线游玩/留存统计，这里全是静态结构数据。`].join("\n");
    },
  },

  map_resource: {
    desc: "同步地图资源：列出该地图已落盘的资产（模型、图片、音频）。",
    needs: ["mapId"],
    async run(ctx, a) {
      const r = await ctx.getJson(`/api/world/${encodeURIComponent(a.mapId)}/asset`).catch(() => null);
      const list = (r && (r.assets || r.files)) || [];
      if (!Array.isArray(list) || !list.length) return `地图 ${a.mapId} 还没有落盘资产。`;
      return `资产 ${list.length} 个：\n` + list.map((f) => `${f.path || f}  ${f.bytes ?? f.size ?? 0}B`).join("\n");
    },
  },

  file_createProject: {
    desc: "创建项目：新建一张地图（默认带一层地面，避免玩家一出生就掉出世界）。shape 形如 64,64,64。",
    needs: ["name"],
    async run(ctx, a) {
      const id = String(a.mapId || "m" + Date.now().toString(36));
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return { text: `mapId 不合法：${id}（只允许字母数字下划线连字符）`, isError: true };
      const shape = String(a.shape || "64,64,64").split(",").map(Number);
      if (shape.length !== 3 || shape.some((n) => !(n > 0 && n <= 512))) return { text: `shape 要三个 1..512 的数字，收到 ${a.shape}`, isError: true };
      const indices = [], data = [], rot = [];
      const floor = a.floor === undefined ? 0 : Number(a.floor);
      if (floor >= 0) {
        for (let x = 0; x < shape[0]; x++) for (let z = 0; z < shape[2]; z++) {
          indices.push(x + floor * shape[0] + z * shape[0] * shape[1]); data.push(1); rot.push(0);
        }
      }
      const ok = await ctx.writeWorld(id, { formatVersion: "unity", shape, dir: [1, 1, 1], indices, data, rot, meta: { name: a.name, created: Date.now() } });
      if (!ok) return { text: "写入失败，看服务端日志", isError: true };
      return `已创建地图 ${id}（${a.name}，${shape.join("×")}，地面 ${indices.length} 格）\n创作端：${ctx.editor}/edit/${id}`;
    },
  },

  file_upLoad: {
    desc: "上传 JS 文件：把一段脚本写进地图的指定端（server / client）。等价于官方 apc upload 的本地版。",
    needs: ["mapId", "end", "code"],
    async run(ctx, a) {
      const w = await ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const end = String(a.end || "").toLowerCase();
      if (end !== "server" && end !== "client") return { text: `end 只能是 server 或 client，收到 ${a.end}`, isError: true };
      w.meta = w.meta || {};
      if (!Array.isArray(w.meta.scripts)) w.meta.scripts = [];
      const name = a.name || "index.js";
      let s = w.meta.scripts.find((x) => x.name === name);
      if (!s) { s = { name, server: "", client: "" }; w.meta.scripts.push(s); }
      s[end] = String(a.code);
      if (!await ctx.writeWorld(a.mapId, w)) return { text: "写入失败", isError: true };
      return `已写入 ${a.mapId} 的 ${end} 端脚本「${name}」（${s[end].length} 字符）。地图现有 ${w.meta.scripts.length} 个脚本。`;
    },
  },

  file_buildNUpload: {
    desc: "构建和上传：从本地 ArenaPro 工程目录读 dist/server 与 dist/client 的 js，合并写进地图两端。",
    needs: ["mapId", "dir"],
    async run(ctx, a) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const w = await ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      // 读的是调用方指定的本地工程目录——这是本工具唯一碰磁盘的地方，
      // 且只读不写：写盘一律走编辑器 HTTP。
      const root = path.resolve(String(a.dir));
      if (!fs.existsSync(root)) return { text: `目录不存在：${root}`, isError: true };
      w.meta = w.meta || {};
      if (!Array.isArray(w.meta.scripts)) w.meta.scripts = [];
      const lines = [];
      for (const [sub, end] of [["server", "server"], ["client", "client"]]) {
        const d = path.join(root, "dist", sub);
        if (!fs.existsSync(d)) { lines.push(`${end}: 没有 ${d}，跳过`); continue; }
        const files = fs.readdirSync(d).filter((f) => /\.(js|cjs|mjs)$/i.test(f));
        if (!files.length) { lines.push(`${end}: ${d} 里没有 js 文件`); continue; }
        const code = files.map((f) => `// ==== ${f} ====\n${fs.readFileSync(path.join(d, f), "utf8")}`).join("\n");
        let s = w.meta.scripts.find((x) => x.name === "index.js");
        if (!s) { s = { name: "index.js", server: "", client: "" }; w.meta.scripts.push(s); }
        s[end] = code;
        lines.push(`${end}: 合并 ${files.length} 个文件，${code.length} 字符`);
      }
      if (!await ctx.writeWorld(a.mapId, w)) return { text: "写入失败", isError: true };
      return `构建上传完成 ${a.mapId}\n` + lines.join("\n");
    },
  },

  file_checkDts: {
    desc: "检查 Dts 文件：拿编辑器携带的 API 规范核对脚本引用的成员是否真实存在。",
    needs: ["code"],
    async run(ctx, a) {
      const spec = await cachedJson(ctx, SPEC_PATH);
      const known = new Set();
      eachMember(spec, (cname, cls, m) => { known.add(cname); if (m) known.add(m.name); });
      if (known.size < 50) return { text: `读不到 API 规范（${ctx.editor}${SPEC_PATH}）。编辑器服务在跑吗？规范是 npm run build:api-ref 生成的。`, isError: true };
      // 先剥注释与字符串：否则注释里的示例、日志文案里的 world.say 都会被当成引用
      const code = String(a.code).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
        .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, '""');
      const used = new Map();
      for (const m of code.matchAll(/\b(world|player|game|entity)\.([A-Za-z_$][\w$]*)/g)) if (!used.has(m[2])) used.set(m[2], m[1]);
      const unknown = [...used.entries()].filter(([name]) => !known.has(name));
      const lines = [`规范里有 ${known.size} 个名字；脚本引用了 ${used.size} 个成员。`];
      if (unknown.length) {
        lines.push(`查不到的 ${unknown.length} 个：`);
        for (const [name, obj] of unknown.slice(0, 20)) lines.push(`  ${obj}.${name}  ← 规范里没有这个成员`);
        lines.push("注意：其中可能有你自己挂在对象上的自定义字段，那不算错；拼错的官方接口才是。");
      } else lines.push("全部能在规范里找到。");
      return lines.join("\n");
    },
  },

  chatjpt_onlyKnowledgeBase: {
    desc: "仅查询知识库：在编辑器携带的 API 规范（含官方中文说明与单位）里检索。不联网、不调模型。",
    needs: ["query"],
    async run(ctx, a) {
      const spec = await cachedJson(ctx, SPEC_PATH);
      if (!spec) return { text: `读不到 API 规范（${ctx.editor}${SPEC_PATH}）`, isError: true };
      const hits = searchSpec(spec, a.query);
      return hits.length ? hits.join("\n")
        : `知识库里没找到「${a.query}」。这通常意味着**官方没有这个接口**——不要凭印象编一个出来。试试类名（GameWorld / GamePlayer）或成员名（say / raycast）。`;
    },
  },

  component_showComponentStats: {
    desc: "显示组件统计：这张地图的界面节点、区域、商品、脚本与实体分布。",
    needs: ["mapId"],
    async run(ctx, a) {
      const w = await ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const m = w.meta || {};
      const byType = {};
      for (const n of (m.ui || [])) { const k = n.type || n.kind || "?"; byType[k] = (byType[k] || 0) + 1; }
      const atlas = await cachedJson(ctx, ATLAS_PATH);
      const n = (k) => (Array.isArray(m[k]) ? m[k].length : 0);
      return [`界面节点 ${n("ui")}${Object.keys(byType).length ? "：" + Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(" ") : ""}`,
        `区域 ${n("zones")}、商品 ${n("products")}、脚本 ${n("scripts")}、实体 ${n("entities")}`,
        `方块种类 ${atlas && atlas.blocks ? atlas.blocks.length : "未知"}`].join("\n");
    },
  },

  file_outputName: {
    desc: "输出和更新文件：把内容写到该地图的资产目录（供脚本 resources.ls 读取）。",
    needs: ["mapId", "path", "content"],
    async run(ctx, a) {
      const raw = String(a.path).replace(/^[/\\]+/, "");
      // 带 .. 的直接拒，不做"清洗后照写还报成功"。
      // 真正的边界由服务端的资产接口把守；这里先拒是为了给调用方一个明确理由，
      // 而不是让它收到一个看不懂的 400。
      if (raw.split(/[/\\]/).some((seg) => seg === "..")) return { text: "拒绝：path 里不允许有 .. 段（只能写在该地图资产目录内）", isError: true };
      if (!raw) return { text: "path 不能为空", isError: true };
      const body = typeof a.content === "string" ? a.content : JSON.stringify(a.content, null, 2);
      const r = await ctx.postAsset(a.mapId, raw, body);
      if (!r.ok) return { text: `写入失败：${r.error || "未知原因"}`, isError: true };
      return `已写 ${raw}（${r.bytes ?? body.length}B）→ ${ctx.editor}/assets/${a.mapId}/${raw}`;
    },
  },
};

/**
 * 官方有但这里**做不到**的。仍然出现在 tools/list 里：
 * 客户端按官方清单调用时若拿到 "unknown tool"，Agent 会以为契约对不上而开始猜接口。
 * 给一个明确的"不支持 + 为什么"比沉默或假装成功都好。
 */
export const UNSUPPORTED = {
  userCenterTool_userTokenAndUA: "本工具没有账号系统，不存在 Token / UserAgent，也不会代你向神岛发起授权。要连官方账号请用官方 ArenaPro 插件。",
  userCenterTool_userInfo: "本工具没有账号系统，查不到用户信息。",
  userCenterTool_accountsLogin: "本工具不做登录：没有可登录的账号体系。",
  userCenterTool_accountsLogout: "本工具没有会话可登出。",
  file_npm_package_get: "不查 npm registry。包清单见编辑器仓库的 docs/dependencies.md。",
  file_npm_package_path: "同上。",
  file_openArena: "这是 IDE 动作，本工具无法替你打开资源管理器。",
  file_reHMR: "编辑器无构建步骤、无 HMR：改完文件直接刷新浏览器。",
  file_stopHMR: "同上，没有 HMR 可停。",
  file_debugger: "调试器是 IDE 能力，本工具不接管。",
  file_openOutputLog: "日志在启动编辑器的那个终端里；接口统计可 GET /api/stats。",
  file_dao3config_open: "本工具不读写 dao3.config.ts；地图配置在 world 的 meta 字段里。",
  file_nodeJs_setting: "本工具与编辑器都只用 Node 内置模块，没有第三方依赖要配。",
};

export function toolDefs() {
  const out = [];
  for (const [name, t] of Object.entries(TOOLS)) {
    const props = {};
    for (const n of t.needs) props[n] = { type: "string", description: n };
    out.push({ name, description: t.desc, inputSchema: { type: "object", properties: props, required: t.needs } });
  }
  for (const [name, why] of Object.entries(UNSUPPORTED)) {
    out.push({ name, description: `【本地不支持】${why}`, inputSchema: { type: "object", properties: {} } });
  }
  return out;
}
