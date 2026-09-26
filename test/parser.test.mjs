/**
 * parser.test.mjs — d.ts 解析器的独立对账。
 *
 * 用另一套**独立实现**（字符走一遍、按深度 1 的分号切语句）数同样的成员，
 * 和 parseDts 的结果逐类比对。同一套代码自证只会把 bug 复制两遍——
 * 之前按行推进的版本就是这么把 GamePlayer 的 116 个成员数成 15 个的。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { parseDts } from "../mcp/project.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "project");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 300) : "")); }
};

/** 独立口径：整字符扫描，跳过注释与字符串，深度 1 的分号即语句边界。 */
function oracle(src, name) {
  const re = new RegExp("declare (?:class|interface|const) " + name + "\\b[^{;]*\\{");
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length - 1;
  let depth = 0, buf = "", out = [];
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") { while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === '"' || c === "'" || c === "`") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } continue; }
    if (c === "{") { depth++; if (depth > 1) buf += c; continue; }
    if (c === "}") { depth--; if (depth === 0) { if (buf.trim()) out.push(buf.trim()); break; } buf += c; continue; }
    if (c === ";" && depth === 1) { if (buf.trim()) out.push(buf.trim()); buf = ""; continue; }
    if (depth >= 1) buf += c;
  }
  const MOD = "(?:readonly|static|abstract|get|set|private|public|protected|override)";
  /* 同名重载会产生多条语句（官方 URL 类就有 25 条语句、15 个名字），
     而解析器按名字去重——对账要两边都取唯一名集合，否则永远是"独立口径更多"。 */
  return [...new Set(out.map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => new RegExp(`^(?:${MOD}\\s+)*[A-Za-z0-9_$]+\\s*(\\??\\s*[:<(])`).test(s))
    .map((s) => new RegExp(`^(?:${MOD}\\s+)*([A-Za-z0-9_$]+)`).exec(s)[1]))];
}

const game = readFileSync(join(FIX, "server/types/GameAPI.d.ts"), "utf8");
const client = readFileSync(join(FIX, "client/types/ClientAPI.d.ts"), "utf8");
const g = parseDts(game, "server");
const c = parseDts(client, "client");

ok("夹具用的是 CRLF（官方 d.ts 就是 CRLF）", game.includes("\r\n"));

/* --- 与独立实现对账 --- */
for (const [side, src, types] of [["server", game, g], ["client", client, c]]) {
  for (const name of Object.keys(types)) {
    const t = types[name];
    if (!["class", "interface", "const"].includes(t.kind)) continue;
    const o = oracle(src, name);
    if (!o) continue;
    const p = Object.keys(t.members);
    ok(`${side} ${name}：与独立口径一致（${o.length}）`,
      o.length === p.length && o.every((n) => p.includes(n)),
      `独立=[${o}] 解析=[${p}]`);
  }
}

/* --- 官方 d.ts 里真实存在的坑，逐条钉住 --- */
const wm = g.GameWorld.members;
ok("@zh 单独一行时说明取到下一行", wm.say.zh === "向所有玩家广播一条消息。", wm.say.zh);
ok("@param 后的第二个 @zh 不顶掉成员说明", !/要广播的文本消息/.test(wm.say.zh), wm.say.zh);
ok("参数含内联对象类型的成员不丢（sound）", !!wm.sound, Object.keys(wm).join(","));
ok("sound 的中文说明仍在", wm.sound.zh === "播放一段音效。", wm.sound.zh);

const vm = g.GameVector3.members;
ok("private constructor 记为成员", !!vm.constructor, Object.keys(vm).join(","));
ok("toString 记为成员（Object.prototype 曾把它吃掉）", !!vm.toString, Object.keys(vm).join(","));
ok("返回值是对象类型的成员不丢（getAxisAngle）", !!vm.getAxisAngle, Object.keys(vm).join(","));
ok("@link 保留下来", /docs\.dao3\.fun/.test(vm.getAxisAngle.link || ""), vm.getAxisAngle.link);

ok("declare const 的对象成员也收（console.log）", !!g.console?.members?.log, JSON.stringify(Object.keys(g.console?.members || {})));
ok("type / function 也进索引", g.GameLoggerMethod?.kind === "type" && g.sleep?.kind === "function");
ok("客户端端标记正确", c.UiText.side === "client" && g.GameWorld.side === "server");
ok("类级说明取到", g.GameQuaternion.zh.includes("x, y, z, w"), g.GameQuaternion.zh);

/* --- 真实规模：官方 GameAPI 有 100+ 个顶层类型，夹具至少不能解析成 0 --- */
const total = (o) => Object.values(o).reduce((n, t) => n + Object.keys(t.members).length, 0);
ok("标量全局被收进索引（declare const world: GameWorld）", !!g.world && g.world.kind === "const" && g.world.side === "server", JSON.stringify(Object.keys(g).slice(0, 12)));
ok("标量全局带中文说明", g.world?.zh === "本地图的世界入口。", g.world && g.world.zh);
ok("夹具规模合理", Object.keys(g).length >= 5 && total(g) >= 12, `${Object.keys(g).length} 类 / ${total(g)} 成员`);

/*
 * 夹具太小，扛不住官方 d.ts 里的真实花样（24585 行、内联对象、CRLF、@category）。
 * 手上有官方工程时把路径传进来，用同一套独立口径再对一遍：
 *   REAL_GAMEAPI=~/my-arena/server/types/GameAPI.d.ts node test/parser.test.mjs
 */
const real = process.env.REAL_GAMEAPI && resolve(process.env.REAL_GAMEAPI);
if (real && existsSync(real)) {
  const src = readFileSync(real, "utf8");
  const t = parseDts(src, "server");
  let diff = 0, checked = 0;
  for (const name of Object.keys(t)) {
    const tt = t[name];
    if (!["class", "interface", "const"].includes(tt.kind)) continue;
    const o = oracle(src, name);
    if (!o) continue;
    checked++;
    const p = Object.keys(tt.members);
    if (o.length !== p.length || !o.every((n) => p.includes(n))) {
      diff++;
      if (diff <= 5) console.log(`      DIFF ${name} 独立=${o.length} 解析=${p.length} 缺=[${o.filter((n) => !p.includes(n)).slice(0, 5)}]`);
    }
  }
  ok(`真实 d.ts：与独立口径一致（可比 ${checked} 类，${total(t)} 成员）`, diff === 0, `${diff} 个类不一致`);
} else if (process.env.REAL_GAMEAPI) {
  console.log(`跳过真实 d.ts 对账：找不到 ${real}`);
} else {
  console.log("提示：带 REAL_GAMEAPI=<官方工程的 GameAPI.d.ts> 可以再对一遍真实规模");
}


console.log(`\nparser: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
