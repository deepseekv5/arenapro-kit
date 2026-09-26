---
name: arenapro
description: 在官方 ArenaPro（dao3.fun / 神奇代码岛的桌面创作端）工程里干活时使用——认工程结构、读写两端脚本、查官方 API 签名与中文说明、判断该跑哪条 apc 命令，或通过本地 MCP 端点操作 ArenaPro。触发场景：ArenaPro、神岛、dao3 地图脚本、GameAPI/ClientAPI、apc 构建上传、工程目录与 env、MCP 工具接入。也负责拦住两类常见错误：把不存在的接口名编出来、以及把官方「格/tick」单位当成秒。
---

# ArenaPro 接入

## 这个包是什么

`arenapro-kit` 是**官方 ArenaPro 的客户端接入层**：一个本地 MCP 端点 + 一份给 AI 的规范。
它不冒充 ArenaPro，也不替代官方插件——插件在跑就把它的工具原样透传，插件不在就把
"做不到 + 该跑什么命令"讲清楚。

三条硬边界，别试图绕过：

1. **只走本地。** 不调 `code-api-pc.dao3.fun`，不读任何凭据文件（`auth.json`、`.env` 里的
   `VITE_DAO3_AUTH` / `VITE_DAO3_UA` 值永不出现在输出里）。
2. **不碰公网。** 需要登录/同步资源/上传时，只给你命令原文，由人决定。
   连本机 Creator 引擎（`127.0.0.1:3127`）是允许的——那是你自己机器上的服务；
   但**只读命令自动跑，写命令必须 `confirm:true`**，且本包拒绝代传 `--token`。
3. **不编接口。** 官方没有的接口名，直接说没有。

## 开工先做三件事

```bash
node scripts/arenapro.mjs info          # 这是不是 ArenaPro 工程？bundle、env、d.ts、脚本数
node scripts/arenapro.mjs dts           # 官方类型声明齐不齐？缺就给 apc map resource 命令
node scripts/arenapro.mjs api <关键词>   # 写任何 API 调用前先查一次
```

在 MCP 侧对应 `project_info` / `dts_check` / `api_search`。

## 该用哪个工具

| 想做的事 | 用 | 说明 |
|---|---|---|
| 看工程全貌 | `project_info` | 第一步。不是工程会明确告诉你并给出 `apc project create` |
| 读/改脚本 | `script_read` / `script_write` | 路径钉死在工程根内；整份覆盖，不是补丁 |
| 查接口 | `api_search` / `api_class` | 读工程**自带**的 `GameAPI.d.ts` / `ClientAPI.d.ts` |
| 类型声明缺不缺 | `dts_check` | 缺什么给什么 `apc` 命令 |
| 看绑定的地图 | `env_show` | 凭据只报"有没有" |
| 该跑什么命令 | `apc_plan` | 只出命令文本 |
| 看本机引擎 | `engine_status` | Creator 连不连得上、apc 装没装、什么版本 |
| 列引擎里的地图 | `engine_projects` | 只读，走 `apc map list --json` |
| 读地图上的脚本 / 数据 | `engine_script_get` / `engine_storage_get` | 只读 |
| 看预览运行状态 | `engine_runtime_status` | 只读 |
| 跑一条 apc | `engine_run` | 写操作必须带 `confirm:true`，命令原文会回显 |
| 构建产物是否过期 | `build_status` | 判断要不要 `npm run build` |
| 上传 / 统计 / 账号 | **没有** | 调用会得到 `isError` + 替代做法 |

## 官方 MCP 的真实拓扑

三件事分开看，别以为一个端点全包了：

- **ArenaPro 插件**（VS Code 扩展）：SSE `http://localhost:25315/ap-mcp`，24 个工具，
  管 IDE 侧一切——账号 `userCenterTool_*`、构建上传 `file_*`、地图 `map_*`、知识库
  `chatjpt_onlyKnowledgeBase`。**参数 schema 官方没公开**，所以本包不猜形状，只做透传。
- **`@box3lab/engine-openapi-mcp`**：stdio，6 tool + 5 prompt，走 `/open` 前缀，能写脚本与存储。
- **`@box3lab/statistics-mcp`**：stdio，19 个只读 GET，查用户/地图/统计。

本包默认端口 **25316**，故意让开官方的 25315。插件在线时它提供的名字**以插件为准**，
本包同名的"不支持"条目会自动消失；插件掉线会自动重新探测（5 秒节流），不用重启。

```json
{ "servers": { "arenapro-kit": { "type": "sse", "url": "http://localhost:25316/ap-mcp" } } }
```

## 写脚本时必须遵守的规范

细节在 `references/scripting.md`，最容易咬人的一条先记住：

**单位是「格 / tick」，`TICK_MS = 64` → 15.625 tick/秒，不是 20 TPS。**
`walkSpeed 0.22` 是每 tick 0.22 格 ≈ 3.4 格/秒。当成格/秒，人物会慢 15 倍。

其余要点：四元数是 `xyzw`；两端全局不是一套（写错端不报错，是 `undefined`）；
存储值必须是 `{"content": …}` 形态、≤2MB、`key`≤1000、`storageName`≤50 且 `^[a-zA-Z0-9_]+$`。

## 本机 Creator 引擎

官方引擎 Web 端是一组 Docker 服务，端口分工固定：**3127 Creator**、**3125 登录**、
**3124 玩家管理**、**3123 VOXA**。它的 HTTP 接口**官方没有公开文档**，
所以本包不直连私有路径，而是驱动官方 CLI `apc`（一律 `--json`，只解析标准输出、
用非零退出码当失败信号）。

未登录时 3127 会 307 → `/projects` → 再跳到 3125 的登录页。本包跟着跳、看落点，
据此区分"服务没起"与"只是没会话"，并把整条跳转链原样回显。

## 工程与命令的对应关系

`client/src` 与 `server/src` 是两端入口，产物在 `dist/{client,server}/<bundle>.<side>.js`。
改完脚本要生效到地图，链条是：

```
npm run build   →   apc script upload …  （或 VITE_UPDATE_FILE=true 让构建后自动传）
```

本包能替你做完的止于**改文件**。构建与上传要出网，交回人跑。
更多结构、env 键、全局配置路径见 `references/project.md`；
`apc` 的九个命令与三处"文档与代码不一致"见 `references/apc.md`。

## 绝不做的事

- **不编接口名。** `api_search` 查不到就回答"官方没有这个接口"。一个看起来很合理的假接口，
  比空实现更难发现。
- **不假装成功。** 上传/账号/统计类工具返回 `isError` 并说明为什么，绝不返回假 token、
  假 URL、假"已上传"。
- **不碰凭据。** 不读 `auth.json`，不打印 `VITE_DAO3_AUTH` / `_UA` 的值。
- **不越界写文件。** 绝对路径、`..`、非源码类型一律拒；目标在你读过之后被改过就先问，
  别盖掉 IDE 的自动格式化结果。
- **不假设脚手架版本，也不假设 CLI 版本。** 官方明说"不同版本的脚手架目录可能略有差异"，
  以 `info` 读到的实际结构为准。CLI 0.5.x 与 0.7.0 的命令面和 env 键名**完全不同**
  （`apc upload` / `VITE_DAO3_MAP_ID` → `apc script upload` / `VITE_BOX_CREATOR_PROJECT_ID`）。
  给命令前先让人跑 `apc --version` 与 `apc docs`。

## CLI

零依赖，与 MCP 共用同一份工具实现，所以两边行为一致：

```bash
node scripts/arenapro.mjs info
node scripts/arenapro.mjs api say
node scripts/arenapro.mjs class GamePlayer
node scripts/arenapro.mjs read server/src/App.ts
node scripts/arenapro.mjs write server/src/App.ts -        # 从 stdin
node scripts/arenapro.mjs plan upload
node scripts/arenapro.mjs help
```

通用参数 `--project <ArenaPro 工程目录>`，默认当前目录。

## Resources

- `references/project.md` — 工程结构、`dao3.config.ts`、env 键、全局配置路径、构建产物约定
- `references/apc.md` — `apc` 九个命令与参数，以及三处文档与代码不一致的地方
- `references/scripting.md` — 官方脚本规范：两端全局划分、单位制、四元数、颜色量纲、存储约束、假接口禁用
