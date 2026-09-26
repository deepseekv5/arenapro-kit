// 介绍页与 README 的自检：结构完整 + 文档里的数字必须等于代码里的数字。
// 网络检查是 opt-in 的（默认离线也要能跑）：NET=1 node test/site.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TOOLS, REFUSED } from "../mcp/tools.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(ROOT, "docs/index.html"), "utf8");
const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + extra : "")); }
};

const nLocal = Object.keys(TOOLS).length;
const nRefused = Object.keys(REFUSED).length;

ok("tools.mjs 的规模与预期一致", nLocal === 10 && nRefused === 46, `实际 ${nLocal}/${nRefused}`);

// 文档里写死的数字漂移过一次教训：版本号在四处各写一遍。
for (const [file, text] of [["index.html", html], ["README.md", readme]]) {
  ok(`${file} 说得出 ${nLocal} 个本地工具`, new RegExp(`本地 ${nLocal} 个|${nLocal} 件事|${nLocal} 个工具`).test(text));
  ok(`${file} 说得出 ${nRefused} 个明确不做`, new RegExp(`${nRefused}`).test(text));
  ok(`${file} 的端口是 25316 而不是官方的 25315`, /25316/.test(text));
}
ok("介绍页标题带 arenapro-kit", /arenapro-kit/.test(html));
ok("README 与介绍页都写明「不碰官方远程接口」", /不碰官方远程接口|不调/.test(html) && /不碰官方远程接口/.test(readme));

// 锚点：nav 里每个 #xxx 都得有对应的 section id
const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
const ids = new Set([...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]));
const dead = hrefs.filter((h) => !ids.has(h));
ok("导航锚点全部有落点", hrefs.length > 0 && dead.length === 0, "悬空: " + dead.join(","));

ok("HTML 标签闭合", (html.match(/<\/html>/g) || []).length === 1 && html.trim().endsWith("</html>"));
ok("带 lang 与 viewport", /<html lang="zh-CN">/.test(html) && /name="viewport"/.test(html));
ok("有 description 且提到 ArenaPro", /name="description"[^>]*ArenaPro/.test(html));
ok("深浅两档都有配色", /prefers-color-scheme:dark/.test(html));

// 仓库内相对链接不能指到不存在的文件
const rel = [...new Set([...html.matchAll(/href="(?!https?:|#|mailto:)([^"]+)"/g)].map((m) => m[1]))];
const missing = rel.filter((h) => !existsSync(resolve(ROOT, "docs", h)));
ok("站内相对链接都存在", missing.length === 0, "缺: " + missing.join(","));

// 外链只允许走这几个域，别不知不觉把访客送去第三方
const ext = [...new Set([...(html + readme).matchAll(/https?:\/\/([A-Za-z0-9.-]+)(?::\d+)?/g)].map((m) => m[1]))];
const stray = ext.filter((h) => !["github.com", "deepseekv5.github.io", "www.apache.org", "docs.dao3.fun", "localhost", "127.0.0.1"].includes(h));
ok("外链域名在白名单内", stray.length === 0, "意外域名: " + stray.join(","));

// 静态页里不该出现任何真凭据样串或本机绝对路径
ok("页面不含 token 样串", !/ghp_[A-Za-z0-9]{20,}|eyJhbGciOi/.test(html + readme));
ok("页面不含本机用户目录", !/\/Users\/[a-z]/i.test(html + readme), "泄漏了绝对路径");

// 这是静态站，不该出现需要构建或外部资源的东西
ok("页面不引外部脚本", !/<script\b/i.test(html));
ok("样式内联，无外部 css", !/<link[^>]+stylesheet/i.test(html));
ok("不引用任何 emoji（用户明确要求）", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), "有表情符号");

if (process.env.NET === "1") {
  const urls = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))]
    .map((u) => u.split("#")[0]).filter(Boolean);
  console.log(`\n联网检查 ${urls.length} 个链接`);
  for (const u of urls) {
    let code = 0;
    try {
      const r = await fetch(u, { method: "GET", redirect: "follow", headers: { "user-agent": "arenapro-kit-site-check" } });
      code = r.status;
      await r.body?.cancel();
    } catch (e) { code = e.code || "ERR"; }
    ok(`HTTP ${code}  ${u}`, code === 200);
  }
}

console.log(`\nsite: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
