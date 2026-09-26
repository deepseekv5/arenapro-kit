// 介绍页与 README 的自检：结构完整 + 文档里的数字必须等于代码里的数字。
// 网络检查是 opt-in 的（默认离线也要能跑）：NET=1 node test/site.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(ROOT, "docs/index.html"), "utf8");
const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
const { TOOLS, UNSUPPORTED } = await import(resolve(ROOT, "mcp/tools.mjs"));

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + extra : "")); }
};

const nTools = Object.keys(TOOLS).length;
const nUnsup = Object.keys(UNSUPPORTED).length;

ok("tools.mjs 导出的数量与预期一致", nTools === 11 && nUnsup === 13, `实际 ${nTools}/${nUnsup}`);

// 文档里写死的数字漂移过一次教训：版本号在四处各写一遍。
for (const [file, text] of [["index.html", html], ["README.md", readme]]) {
  ok(`${file} 说得出 ${nTools} 个可用`, new RegExp(`${nTools}\\s*个可用`).test(text));
  ok(`${file} 说得出 ${nUnsup} 个不支持`, new RegExp(`${nUnsup}\\s*个(明说不支持|不支持)`).test(text));
}
const official = nTools + nUnsup;
ok(`官方 ${official} 个工具名全部在册`, new RegExp(`官方 ${official} 个`).test(html + readme));

// 锚点：nav 里每个 #xxx 都得有对应的 section id
const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
const ids = new Set([...html.matchAll(/<section id="([^"]+)"/g)].map(m => m[1]));
const dead = hrefs.filter(h => !ids.has(h));
ok("导航锚点全部有落点", hrefs.length > 0 && dead.length === 0, "悬空: " + dead.join(","));

// 页面结构自己得闭合，Pages 上少一个 </html> 就是渲染成了半截页
ok("HTML 标签闭合", (html.match(/<\/html>/g) || []).length === 1 && html.trim().endsWith("</html>"));
ok("带 lang 与 viewport", /<html lang="zh-CN">/.test(html) && /name="viewport"/.test(html));
ok("有 description 且提到 MCP 与 Skill", /name="description"[^>]*MCP/.test(html) && /Skill/.test(html.match(/name="description" content="([^"]*)"/)[1]));

// 仓库内相对链接不能指到不存在的文件
const rel = [...new Set([...html.matchAll(/href="(?!https?:|#|mailto:)([^"]+)"/g)].map(m => m[1]))]
  .filter(h => !h.startsWith("/"));
const missing = rel.filter(h => !existsSync(resolve(ROOT, "docs", h)));
ok("站内相对链接都存在", missing.length === 0, "缺: " + missing.join(","));

// 外链只允许走这两个域，别不知不觉把访客送去第三方
const ext = [...new Set([...(html + readme).matchAll(/https?:\/\/([A-Za-z0-9.-]+)(?::\d+)?/g)].map(m => m[1]))];
const stray = ext.filter(h => !["github.com", "deepseekv5.github.io", "www.apache.org", "localhost", "127.0.0.1"].includes(h));
ok("外链域名在白名单内", stray.length === 0, "意外域名: " + stray.join(","));

// 这是静态站，不该出现需要构建的东西
ok("页面不引外部脚本", !/<script\b/i.test(html));
ok("样式内联，无外部 css", !/<link[^>]+stylesheet/i.test(html));

if (process.env.NET === "1") {
  const urls = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => m[1]))]
    .map(u => u.split("#")[0]).filter(Boolean);
  console.log(`\n联网检查 ${urls.length} 个链接`);
  for (const u of urls) {
    let code = 0;
    try {
      const r = await fetch(u, { method: "GET", redirect: "follow", headers: { "user-agent": "dao3-site-check" } });
      code = r.status;
      await r.body?.cancel();
    } catch (e) { code = e.code || "ERR"; }
    ok(`HTTP ${code}  ${u}`, code === 200);
  }
}

console.log(`\nsite: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
