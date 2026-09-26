/**
 * creator.mjs — 连本机跑的官方 Creator 引擎。
 *
 * 官方引擎的 Web 端是 Docker 部署的一组服务，端口分工固定
 * （3127 Creator / 3125 登录 / 3124 玩家管理 / 3123 VOXA）。
 * 但它的 **HTTP 接口官方没有公开文档**——硬猜路径会做出一个"看起来能用、一升级就崩"的适配层。
 *
 * 所以这一层不直连私有端点，而是驱动官方 CLI `apc`：
 *   - 0.7.0 起所有命令支持 --json，官方明确"自动化只解析 JSON 标准输出，用非零退出码当失败信号"；
 *   - Token 存在 apc 自己的 Profile 私密凭据里，本包**不读、不打印、不写盘**；
 *   - 只读命令默认放行，写与运行控制必须 confirm:true。
 *
 * 探测 3127 只做一件事：判断"这台机器上有没有这个服务"，用重定向行为当证据，不猜业务接口。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";

const run = promisify(execFile);

/** 官方端口分工（local-engine 文档里写死的）。 */
export const ENGINE_PORTS = {
  3123: "VOXA",
  3124: "玩家管理",
  3125: "登录",
  3127: "Creator",
};

/** 只读命令：不需要 confirm。键是允许的子命令序列前缀。 */
const READONLY = [
  ["profile", "list"], ["profile", "test"],
  ["project", "info"],
  ["map", "list"],
  ["script", "get"],
  ["storage", "list"], ["storage", "get"],
  ["runtime", "status"],
  ["package", "list"],
  ["docs"],
];

/** 会改状态或控制运行：必须 confirm:true。 */
const WRITE = [
  ["profile", "add"], ["profile", "remove"],
  ["project", "create"], ["project", "bind"],
  ["map", "resource"],
  ["script", "upload"],
  ["storage", "set"], ["storage", "delete"],
  ["runtime", "start"], ["runtime", "stop"], ["runtime", "restart"], ["runtime", "logs"],
  ["scene", "capture"],
];

const startsWith = (args, prefix) => prefix.every((p, i) => args[i] === p);
const inList = (args, list) => list.some((p) => startsWith(args, p));

export function classify(args) {
  if (inList(args, READONLY)) return "read";
  if (inList(args, WRITE)) return "write";
  return "unknown";
}

/**
 * 探一下 Creator 在不在，并判断"是活着但没登录"还是"根本没起"。
 * 未认证时 Creator 会一跳 /projects、再跳到 3125 的登录页，所以要连跳几跳看落点。
 * 手动跟随、不带任何凭据，也不猜业务接口。
 */
export async function probeCreator(baseUrl, timeoutMs = 2500) {
  let url = /^https?:\/\//.test(baseUrl) ? baseUrl : `http://${baseUrl}`;
  const hops = [];
  for (let i = 0; i < 4; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    let r;
    try {
      r = await fetch(url, { redirect: "manual", signal: ac.signal });
    } catch (e) {
      return { reachable: false, state: "down", hops, error: String(e.message || e) };
    } finally {
      clearTimeout(t);
    }
    const loc = r.headers.get("location") || "";
    hops.push(`${r.status} ${url.replace(/^https?:\/\//, "")}`);
    // 真实引擎的落点是 http://127.0.0.1:3125/?source=creator&returnUrl=…
    // 判据不能只写端口号：跳到**另一个端口**、或带上 source=creator / returnUrl / login 字样，
    // 都说明"服务活着，但当前没会话"。
    const startPort = new URL(url).port;
    const locUrl = loc ? new URL(loc, url) : null;
    const bounced = locUrl && (
      /3125|login|auth|source=creator|returnUrl/i.test(loc) ||
      (locUrl.port && locUrl.port !== startPort)
    );
    if (bounced) {
      return {
        reachable: true, status: r.status, state: "unauthenticated",
        redirectsTo: loc.replace(/https?:\/\/[^/]+/, "").slice(0, 60), hops,
        hint: "服务在，但当前会话未认证。用 apc profile add 配 Profile，或在浏览器里登录一次 3127。",
      };
    }
    if (r.status >= 300 && r.status < 400 && loc) {
      url = new URL(loc, url).toString();
      continue;
    }
    return { reachable: true, status: r.status, state: r.ok ? "reachable" : "error", hops, hint: null };
  }
  return { reachable: true, state: "redirect-loop", hops, hint: "跳转超过 4 跳，停在最后一跳上。手动开浏览器看一下。" };
}

/** apc 装没装。不跑它，只问版本——顺带拿到真实版本号，避免照旧文档敲命令。 */
export async function probeApc(bin = "apc") {
  try {
    const { stdout } = await run(bin, ["--version"], { timeout: 8000 });
    return { installed: true, version: stdout.trim().split("\n").pop() };
  } catch (e) {
    const code = e.code;
    return { installed: false, reason: code === "ENOENT" ? "未安装" : `无法执行：${e.message || e}` };
  }
}

/** 把参数安全地拼成一条给人看的命令（不用于执行，只用于回显）。 */
export function displayArgs(args) {
  return args.map((a) => (/^[A-Za-z0-9_@:./=-]+$/.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`)).join(" ");
}

/**
 * 跑一条 apc 命令。
 * @param {string[]} args  参数数组——**永远不拼 shell 字符串**，避免注入。
 * @param {{confirm?:boolean, bin?:string, timeoutMs?:number, cwd?:string}} opt
 */
export async function runApc(args, opt = {}) {
  const clean = (args || []).map(String).filter(Boolean);
  if (!clean.length) throw new Error("没给命令。例：[\"map\",\"list\"]");
  if (clean.some((a) => /token|password|secret/i.test(a) && a.includes("=") === false && clean[clean.indexOf(a) - 1] === "--token")) {
    throw new Error("本包不接受凭据参数。Token 由 apc 的 Profile 自己管理。");
  }
  if (clean.includes("--token")) {
    throw new Error("不要通过本包传 --token：请用 apc profile add 配好 Profile，或设 BOX_CREATOR_TOKEN 环境变量。");
  }
  const kind = classify(clean);
  if (kind === "unknown") {
    throw new Error(`不认识的 apc 子命令：${displayArgs(clean)}\n只放行官方文档里的分组命令；写操作要 confirm:true。`);
  }
  if (kind === "write" && opt.confirm !== true) {
    throw new Error(
      `这是会改引擎状态的命令：apc ${displayArgs(clean)}\n` +
      "确认要执行就带 confirm:true。（上传会覆盖地图上的脚本、storage delete 不可撤销、runtime 控制会影响正在预览的地图）"
    );
  }
  const bin = opt.bin || "apc";
  const withJson = clean.includes("--json") || clean[0] === "docs" ? clean : [...clean, "--json"];
  try {
    const { stdout, stderr } = await run(bin, withJson, {
      timeout: opt.timeoutMs || 60000, cwd: opt.cwd, maxBuffer: 16 * 1024 * 1024,
    });
    let data = null;
    try { data = JSON.parse(stdout); } catch { data = null; }
    return { ok: true, command: `apc ${displayArgs(withJson)}`, kind, data, raw: data ? undefined : stdout.trim(), stderr: stderr.trim() || undefined };
  } catch (e) {
    const out = String(e.stdout || "").trim();
    const err = String(e.stderr || e.message || e);
    // 不把任何看起来像凭据的内容带出去
    const scrub = (s) => s.replace(/(bxc_[A-Za-z0-9_-]+|Authorization[^\n]{0,80})/gi, "‹凭据已隐去›").slice(0, 1200);
    return {
      ok: false,
      command: `apc ${displayArgs(withJson)}`,
      kind,
      error: scrub(err),
      stdout: out ? scrub(out) : undefined,
      hint: /ENOENT/.test(err) ? "apc 未安装：npm i -g @box3lab/arenapro-cli" : undefined,
    };
  }
}
