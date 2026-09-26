// 假 apc：只为验证 arenapro-kit 的调用面与 confirm 闸门，不是官方 CLI。
// 写类命令会落一个标记文件，测试据此断言"没被真的执行"。
import { writeFileSync, readFileSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const MARK = process.env.FAKE_APC_MARK || "/tmp/fake-apc-wrote.txt";
const group = args[0], sub = args[1];
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };

if (args[0] === "--version") { console.log("0.7.0"); process.exit(0); }
if (args.includes("--token")) { console.error("假 apc：不该收到 --token"); process.exit(2); }

const isWrite = ["upload", "set", "delete", "start", "stop", "restart", "bind", "create", "capture", "add", "remove", "resource"].includes(sub);
if (isWrite) writeFileSync(MARK, `${args.join(" ")}\n`, { flag: "a" });

switch (`${group} ${sub}`) {
  case "profile list": out({ profiles: [{ name: "local", endpoint: "127.0.0.1:3127", hasToken: true }] });
  case "profile test": out({ ok: true, profile: "local", instance: "creator-fake", tokenConfigured: true });
  case "project info": out({ profile: "local", projectId: "map-fake123", creator: { healthy: true }, node: "22.23.1" });
  case "map list": out({ rows: [{ name: "武器试验场", permanentMapId: "map-fake123", status: "published" }], count: 1 });
  case "script get": out(args.includes("bootstrap.js")
    ? { side: flag("--side") || "server", entry: "bootstrap.js", content: "export default class App {}\n", revision: 7 }
    : { scripts: [{ side: "server", entry: "bootstrap.js" }] });
  case "storage list": out({ rows: [{ key: "user_1", updatedAt: "2026-09-26T00:00:00Z" }], total: 1 });
  case "storage get": out({ key: "user_1", value: { coins: 100 } });
  case "runtime status": out({ state: "running", side: "server", uptimeMs: 1234 });
  case "package list": out({ packages: [{ name: "@dao3fun/ui", version: "1.0.0" }] });
  case "script upload": out({ ok: true, side: flag("server") ? "server" : "client", entry: args[3], revision: 8 });
  default: out({ ok: true, echo: args });
}
