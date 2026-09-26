/**
 * tools.mjs — 本包自己提供的工具。
 *
 * 三条边界，都是刻意的：
 *   1. **只走本地。** 不碰 code-api-pc.dao3.fun，也不读任何凭据文件。
 *      需要账号/上传/统计的官方工具照样出现在 tools/list 里（客户端按官方清单调用时
 *      拿到 unknown tool 会开始猜接口），但调用一律 isError + 该跑哪条 apc 命令。
 *   2. **不代跑网络命令。** 只把命令原文给你，让人决定。
 *   3. **写文件钉死在工程根里**，越界、改类型不允许、目标被人动过就先问。
 *
 * 官方插件的 24 个工具不在这里——那部分是 mcp/bridge.mjs 连上 25315 后原样透传的。
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  projectInfo, findProject, readEnv, envFiles, listScripts, readBundles,
  readProjectFile, writeProjectFile, apiSearch, apiClass, apiIndex,
} from "./project.mjs";

const rootOf = (ctx, argRoot) => {
  const found = findProject(argRoot || ctx.projectRoot || process.cwd());
  if (!found) {
    throw new Error(
      "这里不是 ArenaPro 工程（要同时有 dao3.config.* 与 client/ server/）。" +
      "新建一个：apc create my-project；已有工程请把本服务的工作目录指到工程根，或调用时带 root。"
    );
  }
  return found.root;
};

const j = (o) => JSON.stringify(o, null, 2);

/* ------------------------------- 本地工具 ------------------------------- */

export const TOOLS = {
  project_info: {
    desc: "看当前 ArenaPro 工程：bundle 配置、env 键（凭据只报有无）、两端 d.ts 是否就位、脚本与构建产物数量。第一步就该调它。",
    needs: [],
    props: { root: { type: "string", desc: "工程内任一路径，默认用服务的工作目录" } },
    async run(ctx, a) {
      const info = projectInfo(a.root || ctx.projectRoot || process.cwd());
      if (!info.isProject) return { isError: true, text: j(info) };
      const count = (o) => Object.values(o).reduce((n, t) => n + Object.keys(t.members).length, 0);
      return j({
        root: info.root,
        configFile: info.configFile,
        bundles: info.bundles,
        env: { files: info.envFiles, mode: info.env.file, keys: info.env.keys },
        types: info.dts,
        apiSurface: (() => { const i = apiIndex(info.root); return { classes: Object.keys(i.types).length, members: count(i.types) }; })(),
        scripts: {
          server: info.scripts.src.server.length, client: info.scripts.src.client.length,
          shares: info.scripts.src.shares.length,
          typeFiles: [...info.scripts.types.server, ...info.scripts.types.client, ...info.scripts.types.shares],
          distServer: info.scripts.dist.server, distClient: info.scripts.dist.client,
        },
        pkg: info.pkg ? { name: info.pkg.name, scripts: Object.keys(info.pkg.scripts || {}) } : null,
      });
    },
  },

  script_list: {
    desc: "列出工程两端的源码文件与构建产物（server/ client/ shares/ 与 dist/*）。",
    needs: [],
    props: { root: { type: "string", desc: "工程内任一路径" } },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      return j(listScripts(root));
    },
  },

  script_read: {
    desc: "读工程内一个文件（限 client/ server/ shares/ 等目录内的源码/配置/文档类型）。",
    needs: ["path"],
    props: {
      path: { type: "string", desc: "相对工程根的路径，如 server/src/App.ts" },
      root: { type: "string", desc: "工程内任一路径" },
    },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      const f = readProjectFile(root, a.path);
      return `${f.path}  ${f.bytes}B\n\n${f.text}`;
    },
  },

  script_write: {
    desc: "写工程内一个文件。目标在你读取后被改过会先拒绝（避免盖掉 IDE 自动格式化的结果），确认要覆盖带 force:true。",
    needs: ["path", "content"],
    props: {
      path: { type: "string", desc: "相对工程根的路径" },
      content: { type: "string", desc: "完整文件内容（整份覆盖，不是补丁）" },
      ifUnchangedSince: { type: "number", desc: "script_read 返回的 mtimeMs" },
      force: { type: "boolean", desc: "确认覆盖" },
      root: { type: "string", desc: "工程内任一路径" },
    },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      const r = writeProjectFile(root, a.path, a.content, { ifUnchangedSince: a.ifUnchangedSince, force: a.force });
      return `已${r.created ? "创建" : "覆盖"} ${r.path}（${r.bytes}B）。构建并上传要你自己跑：apc upload`;
    },
  },

  api_search: {
    desc: "在工程自带的 GameAPI.d.ts / ClientAPI.d.ts 里检索官方 API（类名、成员名、中文说明）。查不到就是官方没有这个名字。",
    needs: ["query"],
    props: {
      query: { type: "string", desc: "关键词，如 say、quaternion、存储" },
      limit: { type: "number", desc: "最多返回几条，默认 12" },
      root: { type: "string", desc: "工程内任一路径" },
    },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      const r = apiSearch(root, a.query, Number(a.limit) || 12);
      if (r.missing.length) {
        r.note = `缺少类型声明：${r.missing.join(", ")}。先跑 apc resource -s api 从官方拉进工程。`;
      }
      return j(r);
    },
  },

  api_class: {
    desc: "列出一个官方类/接口的全部成员签名与中文说明（如 GamePlayer、GameWorld、UiText）。",
    needs: ["name"],
    props: { name: { type: "string", desc: "类名" }, root: { type: "string", desc: "工程内任一路径" } },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      return j(apiClass(root, a.name));
    },
  },

  dts_check: {
    desc: "检查工程是否具备官方类型声明与生成的资产/UiIndex 文件，缺什么就给出该跑的 apc 命令。",
    needs: [],
    props: { root: { type: "string", desc: "工程内任一路径" } },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      const want = [
        ["server/types/GameAPI.d.ts", "apc resource -s api"],
        ["client/types/ClientAPI.d.ts", "apc resource -s api"],
        ["shares/types/GameAssets.d.ts", "apc resource -s assets"],
        ["client/UiIndex/index.ts", "apc resource"],
      ];
      const rows = want.map(([p, cmd]) => ({ path: p, exists: existsSync(join(root, p)), fix: cmd }));
      const idx = apiIndex(root);
      return j({ root, rows, missing: rows.filter((r) => !r.exists).map((r) => r.path), apiSurface: idx.sources });
    },
  },

  env_show: {
    desc: "看当前工程绑定的地图与配置。凭据类键（VITE_DAO3_AUTH / _UA）只报有没有，值不会出现。",
    needs: [],
    props: {
      mode: { type: "string", desc: "env 后缀，如 dev → .env.dev；默认 .env" },
      root: { type: "string", desc: "工程内任一路径" },
    },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      const e = readEnv(root, a.mode);
      const mapKeys = ["VITE_DAO3_MAP_ID", "VITE_DAO3_MAP_NAME", "VITE_DAO3_PLAY_HASH", "VITE_DAO3_EDIT_HASH"];
      return j({
        file: e.file, exists: e.exists,
        map: Object.fromEntries(mapKeys.map((k) => [k, e.keys[k]?.value ?? null])),
        credentials: {
          VITE_DAO3_AUTH: e.keys.VITE_DAO3_AUTH?.present ? "已配置（值不显示）" : "未配置",
          VITE_DAO3_UA: e.keys.VITE_DAO3_UA?.present ? "已配置（值不显示）" : "未配置",
        },
        otherKeys: Object.keys(e.keys).filter((k) => !mapKeys.includes(k) && !["VITE_DAO3_AUTH", "VITE_DAO3_UA"].includes(k)),
        files: envFiles(root),
        hint: e.exists ? null : `没有 ${e.file}。绑定地图：apc set <地图ID或名称> --env ${a.mode || ""}`.trim(),
      });
    },
  },

  apc_plan: {
    desc: "把要做的事翻译成该跑的 apc 命令原文。本服务不代跑任何联网命令。",
    needs: ["intent"],
    props: { intent: { type: "string", desc: "login | bindMap | sync | build | upload | preview | create | info" } },
    async run(ctx, a) {
      const map = {
        login: ["apc login", "浏览器授权后写入全局配置；只想给当前工程用：apc login --env"],
        bindMap: ["apc set <地图ID / playHash / 名称>", "把地图信息写进 .env（VITE_DAO3_MAP_ID / _PLAY_HASH / _EDIT_HASH / _MAP_NAME）"],
        sync: ["apc resource", "同步资源与类型声明；只要 API：apc resource -s api；只要静态资源：-s assets"],
        build: ["npm run build", "产物在 dist/server 与 dist/client，文件名形如 bundle.server.js"],
        upload: ["apc upload", "两端依次上传；单端：apc upload server。只认 js/cjs/mjs 并统一改成 .js"],
        preview: ["apc preview", "开创作页；游玩页：apc preview play"],
        create: ["apc create <项目名>", "用官方脚手架建工程（会往目标目录复制，已存在时不提示）"],
        info: ["apc info", "看登录态、当前地图配置、Node/npm/git 版本与 env 文件清单"],
      };
      const want = String(a.intent).toLowerCase();
      const hit = map[want];
      if (!hit) return { isError: true, text: `未知意图 ${a.intent}。可选：${Object.keys(map).join(" | ")}` };
      return `${hit[0]}\n${hit[1]}`;
    },
  },

  build_status: {
    desc: "看构建产物状态：dist 里有没有两端 bundle、是否比源码旧（据此判断该不该重新构建）。",
    needs: [],
    props: { root: { type: "string", desc: "工程内任一路径" } },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      const s = listScripts(root);
      const newest = (list) => list.reduce((m, rel) => Math.max(m, safeMtime(join(root, rel))), 0);
      const srcM = Math.max(newest(s.src.server), newest(s.src.client));
      const distM = Math.max(newest(s.dist.server), newest(s.dist.client));
      return j({
        distServer: s.dist.server, distClient: s.dist.client,
        stale: distM > 0 ? srcM > distM : "还没有构建产物",
        bundles: readBundles(root).bundles,
        command: "npm run build && apc upload",
      });
    },
  },
};

function safeMtime(p) {
  try { return existsSync(p) ? statSync(p).mtimeMs : 0; } catch { return 0; }
}

/* 统计/运营类工具共用同一条理由，但**每条文本都得自包含**：
   AI 只看得到被调用的那一句，"同上"对它没有信息量。 */
const STATS_REFUSED = "查神岛平台的统计与运营数据要出网，本包不碰官方接口。请挂官方 @box3lab/statistics-mcp，或自己在浏览器里看创作端后台。";

/* --------------------- 官方有、但本包明确不做 --------------------- */

/**
 * 这些名字保留在 tools/list 里，调用得到 isError + 原因 + 替代做法。
 * 直接不列出来，客户端会以为契约对不上，然后开始猜接口。
 */
export const REFUSED = {
  userCenterTool_userTokenAndUA: "本包不读凭据、不碰官方账号接口。要拿 Token 请用官方 ArenaPro 插件，或自己跑 apc login（写入全局配置）。",
  userCenterTool_userInfo: "本包不读凭据、不碰官方账号接口。账号信息请由官方 ArenaPro 插件提供，或在终端跑 apc info。",
  userCenterTool_accountsLogin: "请自己跑 apc login。授权会在浏览器里打开 dao3.fun，本包不代跑联网命令。",
  userCenterTool_accountsLogout: "本包不管理登录态。",
  "script.saveOrUpdate": "写脚本到神岛地图要出网，本包不做。构建后请跑 apc upload（或配 vite-plugin-arenapro-script 自动上传）。",
  "script.rename": "需要官方接口。本包能改工程内文件名与内容，但改名后必须重新构建上传。",
  "storage.get": "地图运行时存储要出网。本地开发请在地图脚本里用 GameWorld 的 storage API，或用 apc 相关命令。",
  "storage.set": "写线上存储要出网，本包不做。地图运行时的存储请在脚本里用官方 storage API；要离线跑就把数据写在工程内的 json 资产里。",
  "storage.remove": "删线上存储键要出网，本包不做。请挂官方 @box3lab/engine-openapi-mcp 或在脚本里处理。",
  "storage.page": "分页读线上存储要出网，本包不做。请挂官方 @box3lab/engine-openapi-mcp。",
  getUserProfileByUserId: STATS_REFUSED,
  getMapInfoByUserId: STATS_REFUSED,
  getMapCommentListByUserId: STATS_REFUSED,
  getMapReleaseInfoByUserId: STATS_REFUSED,
  getMapListByUserId: STATS_REFUSED,
  getModelListByUserId: STATS_REFUSED,
  getFavoriteListByUserId: STATS_REFUSED,
  getRecentlyPlayListByUserId: STATS_REFUSED,
  getFollowerListByUserId: STATS_REFUSED,
  getFriendListByUserId: STATS_REFUSED,
  getFollowingListByUserId: STATS_REFUSED,
  getMapListByKeyword: STATS_REFUSED,
  getCommentList: STATS_REFUSED,
  getLikeList: STATS_REFUSED,
  getSystemMsgList: STATS_REFUSED,
  getMapStatList: STATS_REFUSED,
  getMapPlayerStatList: STATS_REFUSED,
  getMapPlayerRetention: STATS_REFUSED,
  getMapPlayerBehavior: STATS_REFUSED,
  file_reHMR: "官方插件的 HMR 由插件自己管；没检测到插件时本包不会假装重启它。",
  file_stopHMR: "HMR 由官方 ArenaPro 插件自己管；没连上插件时本包不会假装停掉了它。",
  file_debugger: "调试要 VS Code 的 launch 配置（.vscode/launch.json 已指向 dist/{server,client}/bundle.*.js）。本包不驱动 IDE。",
  file_openOutputLog: "本包不驱动 IDE 界面。",
  file_openArena: "本包不驱动 IDE 界面。开创作页用 apc preview。",
  file_dao3config_open: "直接读工程里的 dao3.config.ts：本包的 script_read 就能看。",
  file_nodeJs_setting: "本包不改 IDE 设置。",
  file_npm_package_get: "查 @dao3fun 组织的包请跑 apc npmlist（要出网，本包不代跑）。",
  file_npm_package_path: "本包不改 IDE 设置。",
  file_buildNUpload: "构建+上传要出网。请自己跑：npm run build && apc upload",
  file_upLoad: "上传脚本要出网。请自己跑 apc upload。",
  file_createProject: "脚手架由官方 CLI 做：apc create <项目名>。本包不复制它的模板，避免两份模板各自漂移。",
  map_showMap: "打开创作端要官方插件在跑（透传模式）；否则用 apc preview。",
  map_playData: "游玩数据要出网。请挂官方 @box3lab/statistics-mcp。",
  map_resource: "同步资源要出网。请自己跑 apc resource。",
  chatjpt_onlyKnowledgeBase: "知识库检索在官方插件里（要登录）。本包的 api_search / api_class 直接查工程自带的 d.ts，离线可用。",
  component_showComponentStats: "组件统计要官方插件在跑（透传模式）。",
};

export function toolDefs() {
  const local = Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.desc,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(Object.entries(t.props).map(([k, v]) => [k, { type: v.type, description: v.desc }])),
      required: t.needs,
    },
  }));
  const refused = Object.entries(REFUSED).map(([name, why]) => ({
    name,
    description: `[本包不执行] ${why}`,
    inputSchema: { type: "object", properties: {} },
  }));
  return [...local, ...refused];
}

export async function callLocal(name, args, ctx) {
  const t = TOOLS[name];
  if (!t) {
    if (REFUSED[name]) return { content: [{ type: "text", text: `不支持：${REFUSED[name]}` }], isError: true };
    return { content: [{ type: "text", text: `未知工具 ${name}` }], isError: true };
  }
  const missing = t.needs.filter((k) => args[k] === undefined || args[k] === "");
  if (missing.length) return { content: [{ type: "text", text: `缺少参数：${missing.join(", ")}` }], isError: true };
  try {
    const r = await t.run(ctx, args);
    const text = typeof r === "string" ? r : (r && r.text) || "";
    return { content: [{ type: "text", text }], isError: !!(r && r.isError) };
  } catch (e) {
    return { content: [{ type: "text", text: `失败：${(e && e.message) || e}` }], isError: true };
  }
}
