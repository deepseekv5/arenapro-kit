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
import { probeCreator, probeApc, runApc, ENGINE_PORTS } from "./creator.mjs";
import {
  projectInfo, findProject, readEnv, envFiles, listScripts, readBundles,
  readProjectFile, writeProjectFile, apiSearch, apiClass, apiIndex,
} from "./project.mjs";

const rootOf = (ctx, argRoot) => {
  const found = findProject(argRoot || ctx.projectRoot || process.cwd());
  if (!found) {
    throw new Error(
      "这里不是 ArenaPro 工程（要同时有 dao3.config.* 与 client/ server/）。" +
      "新建一个：apc project create my-project；已有工程请把本服务的工作目录指到工程根，或调用时带 root。"
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
      return `已${r.created ? "创建" : "覆盖"} ${r.path}（${r.bytes}B）。构建与上传要你自己跑：npm run build 后 apc script upload`;
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
        r.note = `缺少类型声明：${r.missing.join(", ")}。先跑 apc map resource --type dts（这一步不需要 Token）。`;
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
        ["server/types/GameAPI.d.ts", "apc map resource --type dts"],
        ["client/types/ClientAPI.d.ts", "apc map resource --type dts"],
        ["shares/types/GameAssets.d.ts", "apc map resource --type assets"],
        ["client/UiIndex/index.ts", "apc map resource --type assets"],
      ];
      const rows = want.map(([p, cmd]) => ({ path: p, exists: existsSync(join(root, p)), fix: cmd }));
      const idx = apiIndex(root);
      return j({ root, rows, missing: rows.filter((r) => !r.exists).map((r) => r.path), apiSurface: idx.sources });
    },
  },

  env_show: {
    desc: "看当前工程绑定的 Creator Profile、永久地图 ID 与构建开关。Token 按官方约定不在 .env 里；任何匹配凭据的键只报有无。",
    needs: [],
    props: {
      mode: { type: "string", desc: "env 后缀，如 dev → .env.dev；默认 .env" },
      root: { type: "string", desc: "工程内任一路径" },
    },
    async run(ctx, a) {
      const root = rootOf(ctx, a.root);
      const e = readEnv(root, a.mode);
      const cur = ["VITE_BOX_CREATOR_PROFILE", "VITE_BOX_CREATOR_PROJECT_ID", "VITE_CURRENT_FILE", "VITE_UPDATE_FILE", "VITE_BOX_CREATOR_VERSION", "VITE_UI_INDEX_PREFIX"];
      const legacy = ["VITE_DAO3_MAP_ID", "VITE_DAO3_MAP_NAME", "VITE_DAO3_PLAY_HASH", "VITE_DAO3_EDIT_HASH"];
      const show = (k) => (e.keys[k] ? (e.keys[k].secret ? "（凭据，值不显示）" : e.keys[k].value) : null);
      return j({
        file: e.file, exists: e.exists,
        binding: {
          profile: show("VITE_BOX_CREATOR_PROFILE"),
          permanentMapId: show("VITE_BOX_CREATOR_PROJECT_ID"),
        },
        build: {
          currentFile: show("VITE_CURRENT_FILE"),
          autoUpload: show("VITE_UPDATE_FILE"),
          versionedUpload: show("VITE_BOX_CREATOR_VERSION"),
          uiIndexPrefix: show("VITE_UI_INDEX_PREFIX"),
        },
        legacy05x: Object.fromEntries(legacy.map((k) => [k, show(k)])),
        credentialsFound: Object.entries(e.keys).filter(([, v]) => v.secret && v.present).map(([k]) => k),
        otherKeys: Object.keys(e.keys).filter((k) => !cur.includes(k) && !legacy.includes(k) && !e.keys[k].secret),
        files: envFiles(root),
        hint: !e.exists
          ? `没有 ${e.file}。绑定地图：apc project bind <permanentMapId> --profile <名字>`
          : (e.keys.VITE_BOX_CREATOR_PROJECT_ID?.present ? null : "缺 VITE_BOX_CREATOR_PROJECT_ID：跑 apc project bind <永久地图 ID>（不能用地图名或临时 hash）"),
      });
    },
  },

  apc_plan: {
    desc: "把要做的事翻译成该跑的 apc 命令原文（0.7.0 分组式）。本服务不代跑任何连 Creator 或出网的命令。",
    needs: ["intent"],
    props: { intent: { type: "string", desc: "profile|bind|create|sync|build|upload|scriptGet|storage|runtime|logs|capture|info|docs" } },
    async run(ctx, a) {
      const map = {
        profile: ["apc profile add local --endpoint 127.0.0.1:3127 --token \"$BOX_CREATOR_TOKEN\"", "把 CLI Token 存进本机 Profile 凭据；不要写进工程 .env"],
        bind: ["apc project bind <permanentMapId> --profile local", "写 VITE_BOX_CREATOR_PROFILE / _PROJECT_ID。要永久地图 ID，不是地图名或临时 hash"],
        create: ["apc project create my-map", "建 Creator Vite 工程，之后 npm install、profile add、project bind、map resource"],
        sync: ["apc map resource --type all", "只要类型声明（不需要 Token）：apc map resource --type dts"],
        build: ["npm run build", "产物在 dist/server 与 dist/client，文件名形如 <bundle>.server.js"],
        upload: ["apc script upload <permanentMapId> server <entry>.js --file ./dist/server/<bundle>.server.js", "直接覆盖地图上的脚本，上限 20MiB 且不保留旧版；先 apc script get 备份"],
        scriptget: ["apc script get", "列共享脚本；读某个：apc script get bootstrap.js --side server"],
        storage: ["apc storage list <space> --page 0 --limit 50", "写：apc storage set <space> <key> --value '{…}'；删必须带 --yes"],
        runtime: ["apc runtime status", "start / stop / restart 控制编辑器里这张地图的 Preview Run，不开浏览器、不发布游玩端"],
        logs: ["apc runtime logs --follow --side server --level error", "断线自动重连；靠本地 dist/ 的 sourcemap 还原 TS 堆栈，调试期别清 dist/"],
        capture: ["apc scene capture --out ./artifacts/view.png", "要求目标地图已在 Creator 编辑器里打开"],
        info: ["apc project info --json", "查 Profile / 永久地图 ID / Token 是否配置 / Creator 健康 / Node 版本"],
        docs: ["apc docs", "输出随包发布的完整 Markdown 文档；apc docs --file 只给路径"],
      };
      const want = String(a.intent).toLowerCase();
      const hit = map[want];
      if (!hit) return { isError: true, text: `未知意图 ${a.intent}。可选：${Object.keys(map).join(" | ")}\n注意 0.5.x 的 apc upload / apc login 在 0.7.0 已换成分组命令，先跑 apc --version 确认本机版本。` };
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
        command: "npm run build && apc script upload <permanentMapId> <side> <entry> --file …",
      });
    },
  },

  /* ------------------------- 引擎连接层 ------------------------- */

  engine_status: {
    desc: "看本机 Creator 引擎与 apc CLI 的状态：3127 连不连得上（未认证会跳登录，这本身就说明服务活着）、apc 装没装、什么版本。不猜私有接口。",
    needs: [],
    props: { creator: { type: "string", desc: "Creator 地址，默认取服务启动时的 --creator" } },
    async run(ctx, a) {
      const target = a.creator || ctx.creator || "127.0.0.1:3127";
      const [creator, apc] = await Promise.all([probeCreator(target), probeApc(ctx.apcBin)]);
      return j({ target, creator, apc, ports: ENGINE_PORTS, note: apc.installed ? "读写引擎请走 engine_projects / engine_run" : "装一下：npm i -g @box3lab/arenapro-cli" });
    },
  },

  engine_projects: {
    desc: "列本机 Creator 引擎里的地图/项目（apc map list --json）。只读。",
    needs: [],
    props: {
      keyword: { type: "string", desc: "按名称或永久地图 ID 过滤" },
      profile: { type: "string", desc: "指定 Creator Profile 名" },
    },
    async run(ctx, a) {
      const args = ["map", "list"];
      if (a.keyword) args.push("--keyword", String(a.keyword));
      if (a.profile) args.push("--profile", String(a.profile));
      return j(await runApc(args, { bin: ctx.apcBin, cwd: ctx.projectRoot }));
    },
  },

  engine_script_get: {
    desc: "读引擎里那张地图上的共享脚本：不带 entry 列清单，带 entry 读内容（只读，不改远程）。",
    needs: [],
    props: {
      entry: { type: "string", desc: "脚本文件名，如 bootstrap.js；省略则只列清单" },
      side: { type: "string", desc: "读具体内容时必填：server 或 client" },
      profile: { type: "string", desc: "指定 Profile 名" },
      project: { type: "string", desc: "永久地图 ID（map-… 那种）" },
    },
    async run(ctx, a) {
      const args = ["script", "get"];
      if (a.entry) args.push(String(a.entry), "--side", a.side === "client" ? "client" : "server");
      if (a.profile) args.push("--profile", String(a.profile));
      if (a.project) args.push("--project", String(a.project));
      return j(await runApc(args, { bin: ctx.apcBin, cwd: ctx.projectRoot }));
    },
  },

  engine_storage_get: {
    desc: "读数据空间：list 分页列键、get 取一条。只读；写和删请自己跑 apc（本包的 engine_run 会要求 confirm）。",
    needs: ["space"],
    props: {
      space: { type: "string", desc: "数据空间名" },
      key: { type: "string", desc: "给了就只读这一条" },
      limit: { type: "number", desc: "list 时每页条数，1..100，默认 50" },
      page: { type: "number", desc: "list 时页码，从 0 开始" },
      scope: { type: "string", desc: "project（默认）或 group" },
    },
    async run(ctx, a) {
      const args = a.key ? ["storage", "get", String(a.space), String(a.key)]
        : ["storage", "list", String(a.space), "--limit", String(Math.min(100, Math.max(1, Number(a.limit) || 50))), "--page", String(Number(a.page) || 0)];
      if (a.scope === "group") args.push("--scope", "group");
      return j(await runApc(args, { bin: ctx.apcBin, cwd: ctx.projectRoot }));
    },
  },

  engine_runtime_status: {
    desc: "看当前地图在 Creator 编辑器里的 Preview Run 状态。只读，不启停。",
    needs: [],
    props: { profile: { type: "string", desc: "指定 Profile 名" }, project: { type: "string", desc: "永久地图 ID" } },
    async run(ctx, a) {
      const args = ["runtime", "status"];
      if (a.profile) args.push("--profile", String(a.profile));
      if (a.project) args.push("--project", String(a.project));
      return j(await runApc(args, { bin: ctx.apcBin, cwd: ctx.projectRoot }));
    },
  },

  engine_run: {
    desc: "跑一条 apc 命令。只读命令直接放行；会改引擎状态的（upload / storage set / storage delete / runtime start|stop|restart / project bind / scene capture）必须带 confirm:true。绝不接受 --token。",
    needs: ["args"],
    props: {
      args: { type: "array", desc: 'apc 参数数组，如 ["script","upload","map-abc","server","App.js","--file","./dist/server/App.server.js"]' },
      confirm: { type: "boolean", desc: "写操作的显式确认" },
    },
    async run(ctx, a) {
      const args = Array.isArray(a.args) ? a.args : String(a.args).split(/\s+/).filter(Boolean);
      return j(await runApc(args, { bin: ctx.apcBin, cwd: ctx.projectRoot, confirm: a.confirm === true }));
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
  userCenterTool_userTokenAndUA: "本包不读凭据、不碰官方账号接口。要拿 Token 请用官方 ArenaPro 插件，或自己跑 apc profile add（Token 存本机 Profile 凭据，不进 .env）。",
  userCenterTool_userInfo: "本包不读凭据、不碰官方账号接口。账号信息请由官方 ArenaPro 插件提供，或在终端跑 apc project info。",
  userCenterTool_accountsLogin: "请自己跑 apc profile add --endpoint 127.0.0.1:3127 --token ‘$BOX_CREATOR_TOKEN’。本包不代跑联网命令。",
  userCenterTool_accountsLogout: "本包不管理登录态。",
  "script.saveOrUpdate": "写脚本到神岛地图要出网，本包不做。构建后请跑 apc script upload（或把 VITE_UPDATE_FILE=true 让构建自动上传）。",
  "script.rename": "需要官方接口。本包能改工程内文件名与内容，但改名后必须重新构建上传。",
  "storage.get": "地图运行时存储要出网。本地开发请在地图脚本里用官方 storage API，或自己跑 apc storage list|get|set。",
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
  file_openArena: "本包不驱动 IDE 界面。创作端就是本机 Creator（默认 127.0.0.1:3127）。",
  file_dao3config_open: "直接读工程里的 dao3.config.ts：本包的 script_read 就能看。",
  file_nodeJs_setting: "本包不改 IDE 设置。",
  file_npm_package_get: "查 @dao3fun 组织的包请跑 apc package list（要出网，本包不代跑）。",
  file_npm_package_path: "本包不改 IDE 设置。",
  file_buildNUpload: "构建+上传要出网。请自己跑：npm run build && apc script upload …",
  file_upLoad: "上传脚本要出网。请自己跑 apc script upload <projectId> <side> <entry> --file …",
  file_createProject: "脚手架由官方 CLI 做：apc project create <项目名>。本包不复制它的模板，避免两份模板各自漂移。",
  map_showMap: "打开创作端要官方插件在跑（透传模式）。本包不启动 Creator，也不代你开地图。",
  map_playData: "游玩数据要出网。请挂官方 @box3lab/statistics-mcp。",
  map_resource: "同步资源要出网。请自己跑 apc map resource --type all。",
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
