#!/usr/bin/env node
/**
 * arenapro.mjs — arenapro-kit 的命令行。零依赖，不需要 npm install。
 *
 * 它和 MCP 服务用的是**同一份 tools.mjs**，所以"CLI 里能做的事"与
 * "AI 通过 MCP 能做的事"不会各说一套。
 * 要出网的事（上传、统计、账号）这里一律没有，只会告诉你该跑哪条 apc 命令。
 *
 *   node scripts/arenapro.mjs <命令> [参数] [--project <ArenaPro 工程目录>]
 */
import { readFileSync } from "node:fs";
import { callLocal, TOOLS } from "../../../mcp/tools.mjs";

const argv = process.argv.slice(2);
const optFlag = (k) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : undefined; };
const pos = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--project" && argv[i - 1] !== "--mode" && argv[i - 1] !== "--limit");
const cmd = pos[0] || "help";
const root = optFlag("project") || process.cwd();
const mode = optFlag("mode");
const limit = Number(optFlag("limit") || 0);

const run = async (name, args) => {
  const r = await callLocal(name, { root, ...args }, { projectRoot: root });
  const text = (r.content || []).map((c) => c.text).join("\n");
  console.log(text);
  if (r.isError) process.exitCode = 1;
};

const j = (o) => JSON.stringify(o, null, 2);

try {
  switch (cmd) {
    case "info": await run("project_info", {}); break;
    case "scripts": await run("script_list", {}); break;
    case "read": await run("script_read", { path: pos[1] }); break;
    case "write": {
      if (!pos[1]) throw new Error("用法：write <工程内相对路径> <内容文件路径 或 - 从 stdin>");
      const content = pos[2] === "-" || !pos[2] ? readFileSync(0, "utf8") : readFileSync(pos[2], "utf8");
      await run("script_write", { path: pos[1], content, force: argv.includes("--force") });
      break;
    }
    case "api": await run("api_search", { query: pos.slice(1).join(" "), limit: limit || undefined }); break;
    case "class": await run("api_class", { name: pos[1] }); break;
    case "dts": await run("dts_check", {}); break;
    case "env": await run("env_show", { mode }); break;
    case "build": await run("build_status", {}); break;
    case "plan": await run("apc_plan", { intent: pos[1] }); break;
    case "tools": console.log(Object.keys(TOOLS).join("\n")); break;
    case "help":
    default:
      console.log(`arenapro-kit — 把 AI 接进官方 ArenaPro（只走本地）

  info                 工程总览：bundle 配置、env 键（凭据脱敏）、d.ts、脚本数
  scripts              两端源码与构建产物清单
  read <路径>           读工程内一个文件
  write <路径> [文件|-]  写工程内一个文件（- 表示从 stdin；--force 才覆盖已改过的）
  api <关键词>           在工程自带的官方 d.ts 里检索（类名/成员/中文说明）
  class <类名>           列出一个官方类的全部成员签名
  dts                  类型声明齐不齐，缺什么给什么 apc 命令
  env [--mode dev]     当前绑定的地图与配置（凭据只报有无）
  build                构建产物状态与是否过期
  plan <意图>           login|bindMap|sync|build|upload|preview|create|info → 该跑的命令

通用：--project <ArenaPro 工程目录>（默认当前目录）

本 CLI 不联网、不读凭据、不代跑上传。需要那些请用官方 ArenaPro 插件或自己跑 apc。`);
  }
} catch (e) {
  console.error("失败：" + ((e && e.message) || e));
  process.exit(1);
}
