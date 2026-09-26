# arenapro-kit

**把 AI 接进官方 [ArenaPro](https://docs.dao3.fun/arenapro/)**（dao3.fun / 神奇代码岛的桌面创作端）。
一个本地 MCP 端点 + 一份给 AI 的规范，让 IDE 里的 Agent 能认工程、改脚本、查官方 API，
而不是只能"写一段代码等人贴进去"。

介绍页：**https://deepseekv5.github.io/arenapro-kit/**

## 它不是什么

先划清边界，这三条是设计决定，不是待办：

| | |
|---|---|
| 不是 ArenaPro 的替代 | 官方插件在跑，就把它的工具**原样透传**；插件没跑也不假装能做 |
| 不碰官方远程接口 | 不调 `code-api-pc.dao3.fun`，不读 `auth.json`，不打印 `.env` 里的凭据值 |
| 不代跑联网命令 | 上传/登录/同步资源只给你命令原文，由人决定 |

需要出网的工具**照样出现在 `tools/list` 里**，调用返回 `isError` + 原因 + 该跑什么。
不列出来才会出问题：客户端按官方清单调用拿到 `unknown tool`，Agent 就认为契约对不上，
然后开始猜接口。

## 三十秒接上

```bash
node mcp/server.mjs --project /path/to/my-arena
```

```
arenapro-kit MCP 已启动     http://127.0.0.1:25316/ap-mcp
工程目录                  /path/to/my-arena
官方插件在线              http://127.0.0.1:25315/ap-mcp · 透传 24 个工具
本包工具                  本地 16 个 · 明确不做 46 个
```

IDE 侧加一个 server（**默认端口 25316，故意让开官方的 25315**）：

```json
{ "servers": { "arenapro-kit": { "type": "sse", "url": "http://localhost:25316/ap-mcp" } } }
```

插件没装也照样能起，只是那 46 个会返回"不支持 + 该跑什么命令"。
插件中途启动/退出都会自动重探（5 秒节流），不用重启本服务。

## 装 Skill

```bash
./install.sh /path/to/your/project     # 软链进该工程的 .qoder/skills/
./install.sh --copy                    # 要落盘副本时用
```

装完 `/arenapro` 即可。默认软链：改这份仓库，所有装了它的工程立刻跟着变——
这类"给 AI 的规范"最容易出的事故就是各处副本各自漂移。

## 官方 MCP 其实是三个东西

搞清拓扑是接进去的前提，官方文档里它们分散在三个页面：

| 来源 | 传输 | 面 | 本包怎么处理 |
|---|---|---|---|
| **ArenaPro 插件**（VS Code 扩展） | SSE `localhost:25315/ap-mcp` | 24 个工具：账号、构建上传、地图、知识库 | **透传**，插件提供的名字以插件为准 |
| `@box3lab/engine-openapi-mcp` | stdio | 6 tool + 5 prompt，写脚本与存储 | 出网 → 明确拒绝并指向 `apc script upload` |
| `@box3lab/statistics-mcp` | stdio | 19 个只读 GET，用户/地图/统计 | 出网 → 明确拒绝 |

官方插件那 24 个工具的**参数 schema 没有公开**，所以本包不猜形状、只做转发——
猜出来的入参比没有更危险。

## 本地能做的 16 件事

| 工具 | 做什么 |
|---|---|
| `project_info` | 认工程：bundle 配置、env 键（凭据脱敏）、d.ts 是否就位、脚本与产物数 |
| `script_list` | 两端源码与 `dist/` 产物清单（`types/` 单独列，不和"我写的脚本"混） |
| `script_read` / `script_write` | 读写工程内文件；路径钉死在工程根，目标被改过先拒绝 |
| `api_search` / `api_class` | 查官方 API 签名与中文说明 |
| `dts_check` | 类型声明缺什么，缺了给哪条 `apc` 命令 |
| `env_show` | 当前绑定的地图；`VITE_DAO3_AUTH` / `_UA` 只报"有没有" |
| `build_status` | 产物是否比源码旧 |
| `apc_plan` | 把意图翻译成该跑的 `apc` 命令 |
| `engine_status` | 探测本机 Creator（3127）与 apc 版本；跟着跳转链判断"活着但没会话" |
| `engine_projects` | 列引擎里的地图/项目（`apc map list --json`） |
| `engine_script_get` | 读地图上的共享脚本（只读） |
| `engine_storage_get` | 读数据空间（只读） |
| `engine_runtime_status` | 看 Preview Run 状态 |
| `engine_run` | 跑一条 apc 命令；**写操作必须 `confirm:true`** |

## API 规范读的是工程自带的 d.ts

**不自带一份规范副本。** 官方类型声明由 `apc map resource --type dts` 拉进工程，跟着工程版本走；
自带一份等于把规范冻结在某个时间点，AI 会拿旧签名写新工程。

- 官方 `GameAPI.d.ts` 有 **24585 行、134 个顶层类型、880 个成员**，`ClientAPI.d.ts` 另有 48 / 145。
- 完整文档 1.7 万词，不该整篇进上下文——所以是"目录 + 按需查"：`api_search` 命中才展开。
- 查不到的输出直接写：*这通常意味着官方没有这个接口——不要凭印象编一个出来。*

解析器踩到的官方写法，都有回归测试钉住：`@zh` 单独一行、`@param` 后第二个 `@zh`、
`private constructor()`、参数里带内联对象类型、返回值是对象类型、CRLF 行尾。

## 三条会咬人的规范

- **单位是「格 / tick」**，`TICK_MS = 64` → **15.625 tick/秒**（不是 20 TPS）。
  `walkSpeed 0.22` ≈ 3.4 格/秒。当成格/秒，人物慢 15 倍。
- **四元数是 `xyzw`。** 实测官方 432 个实体朝向：276 个 `[0,0,0,1]`、**0 个** `[1,0,0,0]`。
- **两端全局不是一套。** 服务端独占 `storage` `voxels` `resources` 与全部 `Game*`；
  客户端独占 `ui` `input` `screen` 与全部 `Ui*`。写错端不会立刻报错，是 `undefined`。

## CLI

零依赖，不需要 `npm install`，和 MCP 共用同一份工具实现（所以两边行为不会各说一套）。

```bash
node skill/arenapro/scripts/arenapro.mjs info
node skill/arenapro/scripts/arenapro.mjs api say
node skill/arenapro/scripts/arenapro.mjs class GamePlayer
node skill/arenapro/scripts/arenapro.mjs read server/src/App.ts
node skill/arenapro/scripts/arenapro.mjs write server/src/App.ts -     # 从 stdin
node skill/arenapro/scripts/arenapro.mjs plan upload
node skill/arenapro/scripts/arenapro.mjs help
```

## 验证

```bash
node test/parser.test.mjs     # 21 条：d.ts 解析器 vs 独立实现
node test/kit.test.mjs        # 48 条：MCP 契约、透传优先级、脱敏、写边界
node test/site.mjs            # 14 条：文档里的数字必须等于代码里的数字
```

`kit.test.mjs` 里**自己实现了一个最小 MCP 客户端**（开 SSE、按 JSON-RPC 走
`initialize → tools/list → tools/call`），不 import 被测模块——自己测自己等于自己给自己打分。
另外起了一个**假插件**当夹具：官方插件本机没装时，"能不能透传、谁优先"也得有地方测。

覆盖：插件提供的名字不被本包的"不支持"盖掉、插件报错如实传回、拒绝文本不含凭据样串、
`.env` 里的 AUTH 值不出现在任何输出、路径穿越与绝对路径被明确拒绝、插件掉线后本地工具照常。

> 这条踩过一次：MCP 的 `endpoint` 帧按规格是纯文本 URL，实现时多包了一层 JSON 引号，
> 结果**任何真实 MCP 客户端都连不上，而本地测试全绿**——因为测试客户端跟着一起错。
> 自测自洽证明不了兼容。

## 许可与来源

Apache-2.0。本仓库只含接入层代码与自写文档，**不含**官方 CLI 源码、官方 d.ts、地图数据或美术素材。
`references/` 里对官方规范的转述基于 [box3-product-document](https://github.com/box3lab/box3-product-document)
（Apache-2.0 © 神岛实验室）；官方两个 stdio MCP 仓库**没有 LICENSE 文件**，
因此这里只对齐它们的工具命名与形状，不复制其文案。

ArenaPro / dao3 及其素材版权归 box3lab 所有。本项目是独立的第三方接入层，
未复制或反编译官方源码。
