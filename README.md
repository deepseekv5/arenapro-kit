# dao3-editor Skill + ArenaPro MCP

介绍页：**https://deepseekv5.github.io/dao3-editor-skill/**（源码在 `docs/index.html`，纯静态单文件，无构建步骤）

让 AI 直接动手用 [dao3 编辑器复刻](https://github.com/deepseekv5/dao3)，
而不是只能"写一段代码等人贴进去"。

一个仓库，两样东西：

| | 是什么 | 给谁用 |
|---|---|---|
| **`mcp/`** | ArenaPro 兼容的 MCP 服务（独立进程） | IDE 里的 Agent |
| **`skill/dao3-editor/`** | Qoder Skill + 零依赖 CLI | 终端里干活的人 / Agent |

两者底下是同一套数据，**都只走编辑器的 HTTP API**——不 import 编辑器的模块，
也不读它的文件。所以编辑器换版本、换目录、甚至换成官方桌面版，这一层都不用改。

## 为什么要独立成仓库

因为被驱动的东西不该和被驱动的接口焊在一起。

之前这两样住在编辑器仓库内部（MCP 作为 `server.js` 的一个路由，靠注入进程内函数干活）。
结果是：想给别人用这个接入层，得先把整个编辑器（含官方素材、地图存档、Three.js）一起给他。
拆开之后依赖方向变成单向的 —— **本仓库依赖编辑器的 HTTP 接口，编辑器不知道本仓库存在。**

## 三十秒接上

前提：编辑器在跑（`node start.mjs --no-open --port=5180`）。

```bash
node mcp/server.mjs
```

```
ArenaPro 兼容 MCP 已启动  http://127.0.0.1:25315/ap-mcp
转发到编辑器            http://127.0.0.1:5180
编辑器在线              dao3-editor-clone 2.1.0
工具                    11 个可用 · 13 个明说不支持
```

**端口 25315、路径 `/ap-mcp` 就是官方 ArenaPro 插件用的那一套**，
所以已经按官方文档配过 `.vscode/mcp.json` 的客户端一个字都不用改：

```json
{ "servers": { "ArenaPro-MCP": { "type": "sse", "url": "http://localhost:25315/ap-mcp" } } }
```

端口被官方插件占了会**明确报错并给出处置办法**，不静默换端口——
IDE 里配的是 25315，悄悄挪到别处等于让客户端去连一个不存在的地方。

## 装 Skill

```bash
./install.sh /path/to/your/project     # 软链进该工程的 .qoder/skills/
./install.sh --copy                    # 要落盘副本时用（跨机器同步、要提交进那个工程）
```

默认软链：改这份仓库，所有装了它的工程立刻跟着变。
这类"给 AI 的规范"最容易出的事故就是各处副本各自漂移。

## 支持什么、不支持什么

`curl -s http://127.0.0.1:25315/api/mcp/tools` 看机器可读的版本。

**可用 11 个**：`file_mapTool` `file_createProject` `map_showMap` `map_playData`
`map_resource` `file_upLoad` `file_buildNUpload` `file_checkDts`
`chatjpt_onlyKnowledgeBase` `component_showComponentStats` `file_outputName`

**明确不支持 13 个**：`userCenterTool_*` 四个、`file_npm_package_*`、
`file_reHMR` / `file_stopHMR` / `file_openArena` / `file_debugger` /
`file_openOutputLog` / `file_dao3config_open` / `file_nodeJs_setting`

两个决定值得说明：

1. **账号类工具绝不假装成功。** 这里没有账号体系，调用返回 `isError` 并写清原因，
   **不会吐出一个假 token**。一个会返回假凭据的登录工具，比没有这个工具危险得多。
   回归里专门有一条：拒绝文本中不得出现像 JWT 的串。
2. **做不到的仍然留在 `tools/list` 里。** 客户端按官方清单调用时若拿到 `unknown tool`，
   Agent 会认为契约对不上而开始猜接口。给一个明确的"不支持 + 为什么"更好。

`file_reHMR` / `file_stopHMR` 不支持其实是好消息：编辑器**没有构建步骤**，改完刷新即可。

## CLI

零依赖，不需要 `npm install`。

```bash
node skill/dao3-editor/scripts/dao3.mjs health
node skill/dao3-editor/scripts/dao3.mjs blocks --grep 草        # 写体素前先查方块 id
node skill/dao3-editor/scripts/dao3.mjs scaffold demo --shape 64,64,64 --floor 0
node skill/dao3-editor/scripts/dao3.mjs fill demo --box 4,1,4,12,6,12 --id 30
node skill/dao3-editor/scripts/dao3.mjs probe demo --at 8,8     # 回读，确认真的落下去了
node skill/dao3-editor/scripts/dao3.mjs api say                 # 查官方 API
node skill/dao3-editor/scripts/dao3.mjs help
```

服务地址用 `DAO3_BASE` 覆盖（默认 `http://127.0.0.1:5180`）。

## 官方 API 全量规范随 skill 一起给

AI 最容易犯的错不是语法，是**编一个看起来合理的接口名**。所以带了三份：

| 文件 | 内容 |
|---|---|
| `references/api.md` | 100 个类的索引 + 端归属 + 成员数（目录，不整篇读） |
| `references/scripting.md` | 两端全局划分、单位制、四元数序、颜色量纲等硬规范 |
| `dao3.mjs api` | 按 1044 个成员精确检索签名与官方中文说明 |

完整文档有 1.7 万词，不该整篇进上下文——那是"目录 + 按需查"的分工。
规范数据从编辑器的 `/data/api-spec.json` 取，和文档站、应用内 AI 注入同源，
所以"AI 以为有的接口"和"实际实现的接口"不会各说一套。

查不到的输出直接写：*这通常意味着官方没有这个接口——不要凭印象编一个出来。*

## 三条会咬人的规范

- **单位是「格 / tick」**，`TICK_MS=64` → **15.625 tick/秒**（不是 20 TPS）。
  `walkSpeed 0.22` ≈ 3.4 格/秒。当成格/秒，人物慢 15 倍。
- **四元数是 `xyzw`。** 实测官方 432 个实体朝向：276 个 `[0,0,0,1]`、**0 个** `[1,0,0,0]`。
- **两端全局不是一套。** 服务端独占 `storage` `voxels` `resources` 与全部 `Game*`；
  客户端独占 `ui` `input` `screen` 与全部 `Ui*`。写错端不会立刻报错，是 `undefined`。

## 边界

- **不联网。** 只做本地 HTTP。规范检索是查本地数据文件，不调模型。
- 没有账号系统：官方登录 / Token / 线上游玩统计拿不到。
- 编辑器**写体素是全量覆盖**，没有补丁接口。两个进程同时改同一张图会互相覆盖。
- **浏览器开着那张图时，编辑器的自动存档可能盖掉 CLI 的改动。** 先关标签页，或改完 `probe` 复查。
- 项目包 `.zip` 导出在编辑器浏览器侧（依赖 Three.js），CLI 里没有等价命令。

## 验证

```bash
node test/site.mjs          # 14 条，纯离线
NET=1 node test/site.mjs    # 20 条，再联网查介绍页每个外链是否还活着
node test/mcp.test.mjs      # 26 条，需要编辑器在跑
```

`site.mjs` 存在的原因是介绍页和 README 里有写死的数字（11 / 13 / 24）。
这类数字漂移过一次教训：**加一个工具，忘了改文档，文档就开始说谎**。
所以它直接 `import` `mcp/tools.mjs` 拿 `TOOLS` / `UNSUPPORTED` 的真实键数来对，
而不是再抄一遍常量。

测试里**自己实现了一个最小 MCP 客户端**：开 SSE、按 JSON-RPC 走
`initialize → tools/list → tools/call`。它不 import 被测模块——自己测自己等于自己给自己打分。

覆盖：官方 24 个工具名全部在册、账号工具返回 `isError` 且不含 JWT 样串、
真建一张图再写脚本再删掉、`checkDts` 不被注释里的假引用骗到、
路径穿越被**明确拒绝**而不是清洗后照写还报成功。

> 这条踩过一次：MCP 的 `endpoint` 帧按规格是纯文本 URL，实现时多包了一层 JSON 引号，
> 结果**任何真实 MCP 客户端都连不上，而本地测试全绿**——因为测试客户端跟着一起错。
> 自测自洽证明不了兼容。

## 许可

Apache-2.0。见 `LICENSE`。
