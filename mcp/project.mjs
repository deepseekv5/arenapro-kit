/**
 * project.mjs — ArenaPro 工程层。
 *
 * 只做本地文件的事：认工程、读 env（脱敏）、列脚本、读写脚本、解析工程自带的
 * GameAPI.d.ts / ClientAPI.d.ts 当 API 规范源。
 *
 * 为什么解析 d.ts 而不是自带一份规范：
 * d.ts 是 `apc map resource --type dts` 从官方拉进工程里的，**跟着工程版本走**。
 * 自带一份等于把规范冻结在某个时间点，AI 会拿旧签名写新工程。
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname, sep, extname } from "node:path";

/** 这些键的值是凭据，任何输出里都不许出现。 */
const SECRET_KEY = /(AUTH|TOKEN|SECRET|PASSWORD|_UA$|USERAGENT)/i;
const ALLOW_EXT = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs", ".json", ".md", ".css", ".html"]);
const MAX_WRITE = 512 * 1024;

/* -------------------------------- 认工程 -------------------------------- */

/** 从 start 往上找 ArenaPro 工程根：dao3.config.* + client/ + server/ 同时存在才算。 */
export function findProject(start = process.cwd()) {
  let dir = resolve(start);
  for (let up = 0; up < 8; up++) {
    const cfg = ["dao3.config.ts", "dao3.config.js", "dao3.config.mjs"].find((f) => existsSync(join(dir, f)));
    if (cfg && existsSync(join(dir, "client")) && existsSync(join(dir, "server"))) return { root: dir, configFile: cfg };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 解析 dao3.config.ts 的 bundles。
 * 不能拿 `\w+:\s*{` 去扫：外层 `bundles: {` 会先匹配上并把 `bundle:` 一起吃掉，
 * 结果只剩一个被跳过的空结果。这里直接认官方那一行形状。
 */
export function readBundles(root, configFile = "dao3.config.ts") {
  const p = join(root, configFile);
  if (!existsSync(p)) return { bundles: [], error: `找不到 ${configFile}` };
  const text = readFileSync(p, "utf8");
  /* 只允许一层嵌套：这样 `bundles: {` 因为里面套了两层而匹配失败，
     扫描器就会退到 `bundle: {` 这一层——否则名字永远取到外层键 bundles。 */
  const entry = /([A-Za-z0-9_$-]+)\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  const out = [];
  for (const m of text.matchAll(entry)) {
    const body = m[2];
    const client = /client\s*:\s*\{\s*entry\s*:\s*['"]([^'"]+)['"]/.exec(body)?.[1];
    const server = /server\s*:\s*\{\s*entry\s*:\s*['"]([^'"]+)['"]/.exec(body)?.[1];
    if (!client || !server) continue;
    out.push({ name: m[1], client, server, enable: !/enable\s*:\s*false/.test(body) });
  }
  if (!out.length) return { bundles: [], error: "没解析出任何 bundle。期望形状：{ bundles: { 名字: { client:{entry}, server:{entry}, enable } } }" };
  return { bundles: out };
}

/* -------------------------------- env -------------------------------- */

/** 官方 CLI 自己按行解析 env：KEY=VALUE，# 注释，不做插值、不去引号、不合并 .env。这里保持一致。 */
export function parseEnvText(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i <= 0) continue;
    out[l.slice(0, i).trim()] = l.slice(i + 1);
  }
  return out;
}

export function envFiles(root) {
  return readdirSync(root)
    .filter((f) => /^\.env(\..+)?$/.test(f) && f !== ".env.example")
    .sort();
}

/** 返回键的存在性与值；凭据类只报"有没有"，值一律不出。 */
export function readEnv(root, mode) {
  const file = mode ? `.env.${mode}` : ".env";
  const p = join(root, file);
  if (!existsSync(p)) return { file, exists: false, keys: {} };
  const raw = parseEnvText(readFileSync(p, "utf8"));
  const keys = {};
  for (const [k, v] of Object.entries(raw)) {
    if (SECRET_KEY.test(k)) keys[k] = { present: v.length > 0, secret: true };
    else keys[k] = { present: v.length > 0, secret: false, value: v };
  }
  return { file, exists: true, keys };
}

/* ------------------------------ 脚本与文件 ------------------------------ */

export function listScripts(root) {
  const side = (d) => {
    const base = join(root, d);
    if (!existsSync(base)) return { src: [], types: [] };
    const found = { src: [], types: [] };
    const walk = (dir, depth) => {
      if (depth > 4) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full, depth + 1); continue; }
        if (!/\.(ts|tsx|js|cjs|mjs)$/.test(e.name)) continue;
        const r = rel(root, full);
        // types/ 下是 apc map resource 拉进来的官方声明，和"我写的脚本"是两回事，混在一起会误导
        (/(^|\/)types\//.test(r) || r.endsWith(".d.ts") ? found.types : found.src).push(r);
      }
    };
    walk(base, 0);
    found.src.sort(); found.types.sort();
    return found;
  };
  const dist = (d) => {
    const base = join(root, d);
    if (!existsSync(base)) return [];
    return readdirSync(base).filter((f) => /\.(js|cjs|mjs)$/.test(f)).map((f) => `${d}/${f}`).sort();
  };
  const s = side("server"), c = side("client"), sh = side("shares");
  return {
    src: { server: s.src, client: c.src, shares: sh.src },
    types: { server: s.types, client: c.types, shares: sh.types },
    dist: { server: dist("dist/server"), client: dist("dist/client") },
  };
}

const rel = (root, p) => p.slice(root.length + 1).split(sep).join("/");

/** 把用户给的相对路径钉死在工程内：绝对路径、..、越界一律拒。 */
export function safeJoin(root, relPath) {
  const want = String(relPath || "");
  if (!want || want.startsWith("/") || /^[A-Za-z]:[\\/]/.test(want)) {
    throw new Error(`路径必须是工程内的相对路径（收到：${want || "空"}）`);
  }
  const abs = resolve(root, want);
  const norm = (s) => s.endsWith(sep) ? s : s + sep;
  if (abs !== resolve(root) && !norm(abs).startsWith(norm(resolve(root)))) throw new Error(`路径越界：${want}`);
  if (!ALLOW_EXT.has(extname(abs).toLowerCase())) throw new Error(`不允许的文件类型：${extname(abs) || "(无后缀)"}`);
  return abs;
}

export function readProjectFile(root, relPath) {
  const abs = safeJoin(root, relPath);
  if (!existsSync(abs)) throw new Error(`文件不存在：${relPath}`);
  const st = statSync(abs);
  if (st.size > MAX_WRITE) throw new Error(`文件过大（${st.size}B），不整份返回`);
  return { path: relPath, bytes: st.size, mtimeMs: st.mtimeMs, text: readFileSync(abs, "utf8") };
}

export function writeProjectFile(root, relPath, text, opt = {}) {
  const abs = safeJoin(root, relPath);
  const body = String(text ?? "");
  if (body.length > MAX_WRITE) throw new Error(`写入内容过大（${body.length}B）`);
  const existed = existsSync(abs);
  if (existed && opt.ifUnchangedSince && statSync(abs).mtimeMs > opt.ifUnchangedSince && !opt.force) {
    throw new Error(`目标在你读取之后被改过（可能是编辑器/IDE 自动格式化）。确认要覆盖就带 force:true`);
  }
  writeFileSync(abs, body, "utf8");
  return { path: relPath, created: !existed, bytes: body.length };
}

/* ------------------------------ d.ts 规范 ------------------------------ */

const cache = new Map();

/**
 * 解一段 JSDoc。官方 d.ts 的写法要注意两点：
 *   1. `@zh` 常常单独一行，正文在下一行（所以要吃到下一个 @ 之前为止）；
 *   2. `@param x` 之后还会再来一个 `@zh` 描述参数——所以取**第一个** @zh 才是成员本身的说明。
 */
function docOf(block) {
  const body = block
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\/?\*+\/?/, "").replace(/\s+$/, ""));

  let desc = "";
  const tags = [];
  let cur = null;
  for (const line of body) {
    const t = line.trim();
    if (!t) continue;
    const m = /^@([A-Za-z]+)\s*(.*)$/.exec(t);
    if (m) {
      cur = { name: m[1].toLowerCase(), value: m[2].trim() };
      tags.push(cur);
    } else if (cur) {
      cur.value = `${cur.value} ${t}`.trim();
    } else {
      desc = `${desc} ${t}`.trim();
    }
  }
  const zh = tags.find((x) => x.name === "zh")?.value || desc;
  const link = tags.find((x) => x.name === "link")?.value || "";
  const category = tags.find((x) => x.name === "category")?.value || "";
  return { zh: zh.trim(), link, category };
}

/** 数大括号前先把字符串字面量挖空，否则 `name: "a{b"` 会把深度带跑。 */
const stripStrings = (s) => s.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

/** 签名截断：参数里带内联对象类型时整条能上千字，全塞进上下文会挤掉真正有用的东西。 */
const shorten = (s, max = 220) => {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…}` : t;
};

/**
 * 解析一份 .d.ts：顶层 declare 的名字、种类，以及它**第一层**成员的签名与 @zh 说明。
 *
 * 先摘注释（注释里也有大括号，混着数会算错深度），再按字符走一遍：
 * `{` `}` `;` 是语句边界，每条语句带着它所在的深度。
 * 之前按行推进 + 手工合并跨行签名，跨行的收尾括号没被计入深度，
 * 结果 GamePlayer 的成员被记到了 GameWorld 名下——类与类之间串了。
 */
export function parseDts(text, side) {
  const lines = text.split(/\r?\n/);
  const code = [];
  let pendingDoc = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("/*")) {
      const buf = [lines[i]];
      while (!buf[buf.length - 1].includes("*/") && i + 1 < lines.length) buf.push(lines[++i]);
      pendingDoc = docOf(buf.join("\n"));
      continue;
    }
    if (!t || t.startsWith("//")) continue;
    code.push({ text: stripStrings(lines[i]), doc: pendingDoc });
    pendingDoc = null;
  }

  const stmts = [];
  let depth = 0;
  let buf = "";
  let doc = null;
  for (const ln of code) {
    if (!buf.trim()) doc = ln.doc;
    const s = ln.text;
    let pos = 0;
    while (pos < s.length) {
      const ch = s[pos];
      if (ch === "{" || ch === "}" || ch === ";") {
        buf += s.slice(pos, pos + 1);
        const text = buf.trim();
        if (text && text !== ch) stmts.push({ depth, text: text.replace(/[;{}]$/, "").trim(), open: ch === "{", close: ch === "}", doc });
        else if (ch !== ";") stmts.push({ depth, text: "", open: ch === "{", close: ch === "}", doc: null });
        buf = "";
        if (ch === "{") depth++;
        else if (ch === "}") depth = Math.max(0, depth - 1);
        pos++;
      } else {
        const nxt = s.indexOf("{", pos);
        const nxt2 = s.indexOf("}", pos);
        const nxt3 = s.indexOf(";", pos);
        const stops = [nxt, nxt2, nxt3].filter((x) => x >= 0);
        const end = stops.length ? Math.min(...stops) : s.length;
        buf += s.slice(pos, end);
        pos = end;
      }
    }
    buf += " ";
  }

  const types = Object.create(null);
  const stack = [];
  const DECL = /^(?:export\s+)?declare\s+(class|interface|const|var|enum|namespace|type|function)\s+([A-Za-z0-9_$]+)/;

  /* members 必须是无原型对象：官方类里真有 `constructor` 和 `toString` 两个成员，
     用 {} 时 `t.members.constructor` 会命中 Object.prototype 上的继承值，
     "已存在"判断就把这两个成员吃掉了。 */
  const register = (st, kind, name) => {
    const t = types[name] || (types[name] = { kind, side, members: Object.create(null) });
    t.kind = kind;
    t.side = side;
    if (st.doc?.zh) t.zh = st.doc.zh;
    return t;
  };

  /* 成员名的修饰符：官方 d.ts 里连 `private constructor()` 都有。 */
  const MEMBER = /^(?:(?:readonly|static|abstract|override|public|private|protected|declare)\s+)*(?:get\s+|set\s+)*([A-Za-z0-9_$]+)\s*(\??\s*[:<(])/;

  /* 栈纪律：每个 { 必 push、每个 } 必 pop。
     不按"是不是顶层声明"区分——嵌套的对象类型也有收尾括号，
     少 pop 一次，之后的成员就全记到别人名下。 */
  for (const st of stmts) {
    if (st.open) {
      const m = st.depth === 0 ? DECL.exec(st.text) : null;
      if (m) register(st, m[1], m[2]);
      /* 深度 1 的 `{` 也是成员：`sound: (spec: { … })` 这种参数里带内联对象、
         或 `getAxisAngle(q): { … }` 这种返回值是对象类型。整条语句会被 `{` 切断，
         不在这里记账就会漏成员（官方 d.ts 里 sound / addEventListener / next 都是这样丢的）。 */
      if (st.depth === 1) {
        const top = stack[stack.length - 1];
        const mm = top?.name ? MEMBER.exec(st.text) : null;
        const t = top?.name ? types[top.name] : null;
        if (mm && t && !t.members[mm[1]]) {
          t.members[mm[1]] = {
            sig: shorten(st.text.replace(/^(readonly|static|abstract|override|public|private|protected|declare|get|set)\s+/, "")),
            zh: st.doc?.zh || "", link: st.doc?.link || "", category: st.doc?.category || "",
          };
        }
      }
      stack.push({ name: m ? m[2] : null });
      continue;
    }
    if (st.close) { stack.pop(); continue; }
    if (!st.text) continue;

    if (st.depth === 1) {
      const top = stack[stack.length - 1];
      if (!top?.name) continue;
      const m = MEMBER.exec(st.text);
      if (!m) continue;
      const t = types[top.name];
      if (t && !t.members[m[1]]) {
        t.members[m[1]] = {
          sig: shorten(st.text.replace(/^(readonly|static|abstract|override|public|private|protected|declare|get|set)\s+/, "")),
          zh: st.doc?.zh || "", link: st.doc?.link || "", category: st.doc?.category || "",
        };
      }
      continue;
    }

    if (st.depth === 0) {
      const m = DECL.exec(st.text);
      if (!m) continue;
      /* 标量全局也要收：`declare const world: GameWorld` 和 `declare const storage: GameStorage`
         就是引擎入口本身。之前只收 type/function，结果 AI 查 world 查不到，
         只能凭印象编一个全局对象出来。 */
      const t = register(st, m[1], m[2]);
      t.sig = st.text.replace(/^export\s+/, "");
    }
  }
  return types;
}

const DTS = { "server/types/GameAPI.d.ts": "server", "client/types/ClientAPI.d.ts": "client" };

/** 工程自带的官方类型声明 → 索引。按 mtime 缓存。 */
export function apiIndex(root) {
  const out = { types: Object.create(null), sources: {}, missing: [] };
  for (const [relPath, side] of Object.entries(DTS)) {
    const p = join(root, relPath);
    if (!existsSync(p)) { out.missing.push(relPath); continue; }
    const st = statSync(p);
    const key = `${p}:${st.mtimeMs}`;
    let types = cache.get(key);
    if (!types) {
      types = parseDts(readFileSync(p, "utf8"), side);
      if (cache.size > 12) cache.clear();
      cache.set(key, types);
    }
    out.sources[relPath] = { side, types: Object.keys(types).length, members: Object.values(types).reduce((n, t) => n + Object.keys(t.members).length, 0) };
    for (const [name, t] of Object.entries(types)) {
      if (!out.types[name]) {
        out.types[name] = { ...t, members: Object.assign(Object.create(null), t.members) };
      } else {
        const dst = out.types[name];
        dst.sides = [...new Set([...(dst.sides || [dst.side]), side])];
        for (const [k, v] of Object.entries(t.members)) if (!(k in dst.members)) dst.members[k] = v;
      }
    }
  }
  return out;
}

/** 精确查名，模糊查说明文本。返回条数有限，避免把 1MB 规范灌进上下文。 */
export function apiSearch(root, query, limit = 12) {
  const idx = apiIndex(root);
  const q = String(query || "").trim();
  if (!q) return { hits: [], total: Object.keys(idx.types).length, note: "给个关键词，比如 say、storage、quaternion" };
  const lower = q.toLowerCase();
  const hits = [];
  for (const [name, t] of Object.entries(idx.types)) {
    if (name.toLowerCase() === lower) hits.push({ name, ...t, why: "类名精确命中" });
  }
  if (!hits.length) {
    for (const [name, t] of Object.entries(idx.types)) {
      if (name.toLowerCase().includes(lower)) hits.push({ name, kind: t.kind, side: t.side, zh: t.zh, why: "类名包含" });
      for (const [m, mem] of Object.entries(t.members)) {
        if (hits.length >= limit * 3) break;
        if (m.toLowerCase().includes(lower)) hits.push({ name, member: m, kind: t.kind, side: t.side, sig: mem.sig, zh: mem.zh, why: "成员名包含" });
        else if (mem.zh && mem.zh.toLowerCase().includes(lower)) hits.push({ name, member: m, kind: t.kind, side: t.side, sig: mem.sig, zh: mem.zh, why: "中文说明命中" });
      }
      if (hits.length >= limit * 3) break;
    }
  }
  return {
    query: q,
    hits: hits.slice(0, limit),
    more: Math.max(0, hits.length - limit),
    total: Object.keys(idx.types).length,
    sources: idx.sources,
    missing: idx.missing,
  };
}

export function apiClass(root, name) {
  const idx = apiIndex(root);
  const want = String(name || "").trim();
  const exact = idx.types[want];
  const tries = exact ? [want] : Object.keys(idx.types).filter((k) => k.toLowerCase() === want.toLowerCase());
  if (!tries.length) {
    const cand = Object.keys(idx.types).filter((k) => k.toLowerCase().includes(want.toLowerCase())).slice(0, 15);
    throw new Error(`规范里没有「${want}」。相近的有：${cand.join(", ") || "无"}。查不到通常意味着官方没有这个名字——不要凭印象编。`);
  }
  const key = tries[0];
  const t = idx.types[key];
  return { name: key, kind: t.kind, side: t.side, sides: t.sides, zh: t.zh, memberCount: Object.keys(t.members).length, members: t.members };
}

/* ------------------------------ 工程总览 ------------------------------ */

export function projectInfo(start = process.cwd()) {
  const found = findProject(start);
  if (!found) {
    return {
      isProject: false, cwd: resolve(start),
      hint: "这里不是 ArenaPro 工程。新建一个：apc project create my-project（需要 @box3lab/arenapro-cli）。",
    };
  }
  const { root, configFile } = found;
  const idx = apiIndex(root);
  return {
    isProject: true, root, configFile,
    bundles: readBundles(root, configFile),
    envFiles: envFiles(root),
    env: readEnv(root),
    dts: { sources: idx.sources, missing: idx.missing },
    scripts: listScripts(root),
    pkg: (() => {
      try { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch { return null; }
    })(),
  };
}
