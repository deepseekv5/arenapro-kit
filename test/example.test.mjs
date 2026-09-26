/**
 * example.test.mjs — 让示例代码自己证明它没编接口。
 *
 * 两件事：
 *   1. 端归属：服务端脚本里不许出现客户端独占全局（反之亦然）。写错端不报错，
 *      只会在运行时拿到 undefined，所以这条必须静态挡住。这条**离线也能跑**。
 *   2. 成员存在性：示例里每个 `world.x` / `board.x` / `page.x` 都要在官方 d.ts 里查得到。
 *      需要一份真实的 GameAPI.d.ts：
 *        ARENA_PROJECT=~/my-arena node test/example.test.mjs
 *      找不到就跳过并说明——不拿夹具糊过去，夹具里没有 GameWorld。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { apiIndex, parseDts } from "../mcp/project.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 300) : "")); }
};

const SERVER = readFileSync(join(ROOT, "examples/scoreboard/server/App.ts"), "utf8");

const CLIENT_ONLY = ["ui", "input", "screen", "media", "screenWidth", "screenHeight", "navigator"];
const SERVER_ONLY = ["world", "voxels", "storage", "resources", "db", "http", "rtc", "analytics", "gui"];

/* --- 1. 端归属（离线必跑） --- */
for (const g of CLIENT_ONLY) {
  const used = new RegExp(`(^|[^.\\w])${g}\\s*\\.`, "m").test(SERVER);
  ok(`服务端脚本没用到客户端全局 ${g}`, !used, `出现了 ${g}.`);
}
ok("服务端脚本确实用了服务端全局", SERVER.includes("world.") && SERVER.includes("storage."));

/* --- 2. 成员存在性（要真 d.ts） --- */
const candidates = [
  process.env.ARENA_PROJECT && join(process.env.ARENA_PROJECT, "server/types/GameAPI.d.ts"),
  process.env.REAL_GAMEAPI,
].filter(Boolean);

const dts = candidates.find((p) => existsSync(p));
if (!dts) {
  console.log("跳过成员存在性检查：没有真实 GameAPI.d.ts。带 ARENA_PROJECT=<ArenaPro 工程> 再跑一次。");
} else {
  const idx = apiIndex(dirname(dirname(dirname(dts))));
  /** 标识符 → 它在 d.ts 里的类型。加新用法时补这张表。 */
  const TYPES = {
    world: "GameWorld", storage: "GameStorage", board: "GameDataStorage",
    entity: "GameEntity", player: "GamePlayer", p: "GameVector3",
    page: "QueryList", row: "ResultValueRecord",
  };
  const missing = [];
  for (const [ident, cls] of Object.entries(TYPES)) {
    const used = [...new Set([...SERVER.matchAll(new RegExp(`\\b${ident}\\.([A-Za-z0-9_$]+)`, "g"))].map((m) => m[1]))];
    if (!used.length) continue;
    const t = cls === "ResultValueRecord"
      ? { members: { key: 1, value: 1, version: 1, updateTime: 1, createTime: 1 } }
      : idx.types[cls];
    if (!t) { missing.push(`${cls}（整类没查到，标识符 ${ident}）`); continue; }
    for (const m of used) if (!t.members[m]) missing.push(`${ident}.${m} → ${cls}.${m}`);
  }
  ok(`示例里每个引擎成员都在官方 d.ts 里（${dts.split("/").slice(-3).join("/")}）`, missing.length === 0, "查不到: " + missing.join(", "));

  // 事件订阅形状：官方 GameEventChannel 是"可调用类型"，写成 .on(...) 是最常见的错觉
  ok("事件用调用式订阅而不是 .on()", !/\bworld\.(onPlayerJoin|onPlayerLeave|onChat)\.on\b/.test(SERVER));
  ok("没有用 clone 之类从别处抄来的方法", !/\bworld\.clone\b/.test(SERVER));
}

console.log(`\nexample: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
