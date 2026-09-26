# 更新日志

## 0.2.0 — 2026-09-26

- **连本机 Creator 引擎。** 官方引擎 Web 端是 Docker 上的一组服务
  （3127 Creator / 3125 登录 / 3124 玩家管理 / 3123 VOXA）。它的 HTTP 接口官方无文档，
  所以不猜私有路径，改为驱动官方 CLI `apc`（一律 `--json`）。新增 6 个引擎工具：
  `engine_status` / `engine_projects` / `engine_script_get` / `engine_storage_get` /
  `engine_runtime_status` / `engine_run`。
- **只读自动、写要确认。** 写与运行控制（`script upload`、`storage set|delete`、
  `runtime start|stop|restart`、`project bind`、`scene capture`）必须 `confirm:true`；
  回归测试用标记文件证明被挡下的命令**进程根本没起来**，而不是只看有没有报错。
- **拒绝代传 `--token`**，也不读 apc 的 Profile 凭据；输出里出现 `bxc_…` 一律隐去。
- **探测跟着跳转看落点**：3127 未登录时 307 → `/projects` → 3125 登录页，
  据此区分「服务没起」与「只是没会话」，并原样回显整条链路。
- 介绍页改成官方 dao3.fun 那套设计语言：深底 + 品牌黄 `#ffdb00` + 胶囊按钮 + 黄色提示卡。
- 修一个真 bug：`/health` 用了只在启动横幅处动态 import 的函数，抛异常**直接把服务进程打挂**。
  现在顶层静态 import，且任何路由异常只让那一个请求失败。
- 断言从 89 条增至 **119 条**（parser 20 + engine 24 + kit 50 + site 25）。

## 0.1.1 — 2026-09-26

- **对齐 `apc` 0.7.0 的契约。** 之前那份命令表是从本地 `vendor/ArenaPro-CLI` 的 **0.5.4** 副本读的，
  而上游早已改成分组命令：`profile / project / map / script / storage / runtime / scene / package / docs`。
  env 键也从 `VITE_DAO3_MAP_ID` 换成 `VITE_BOX_CREATOR_PROFILE` + `VITE_BOX_CREATOR_PROJECT_ID`，
  CLI Token 明确**不再进 `.env`**。
- `env_show` 同时报新键与旧键，并把"违规写进 .env 的凭据键名"点名出来（值一律不显示）。
- `apc_plan` 的意图表重写为 0.7.0 分组式；`dts_check` 的修复命令改成 `apc map resource --type dts`。
- Skill 增加版本漂移护栏：给命令前先确认 `apc --version`。
- 新增语法护栏：`test/site.mjs` 对仓库每个 `.mjs` 跑 `node --check`——批量替换文档字符串时
  把引号套进引号里，服务直接起不来，这类错误不该等运行时才发现。

## 0.1.0 — 2026-09-26

**目标改向：从"驱动 dao3 编辑器复刻"变成"把 AI 接进官方 ArenaPro"。**
包名随之从 `dao3-editor-skill` 改为 `arenapro-kit`。

- **默认端口 25315 → 25316。** 25315 是官方 ArenaPro 插件的端口，一个客户端不该去占它。
  上一版把它当自己的门牌，等于在真插件旁边冒充插件。
- **新增 `mcp/bridge.mjs`：官方插件的 SSE 客户端。** 连得上就 `initialize → tools/list`
  原样透传它的工具；插件提供的名字**以插件为准**，本包同名的"不支持"条目自动消失。
  插件中途启停会自动重探（5 秒节流），不用重启。
- **API 规范改读工程自带的 `GameAPI.d.ts` / `ClientAPI.d.ts`**，不再依赖复刻编辑器的
  `/data/api-spec.json`。规范跟着工程版本走，不会冻结在某个时间点。
  解析器对着官方 24585 行的 d.ts 与一套独立实现逐类对账（62 个可比类，零差异）。
- **只走本地。** 不调 `code-api-pc.dao3.fun`，不读 `auth.json`，不代跑任何联网命令。
  46 个需要出网/驱动 IDE 的官方工具名仍保留在 `tools/list` 里，调用返回 `isError` +
  原因 + 该跑的 `apc` 命令。每条拒绝文本都自包含——AI 只看得到被调用的那一句，"同上"对它没有信息量。
- **凭据脱敏**：`env_show` 对 `VITE_DAO3_AUTH` / `_UA` 只报"有没有"，值不出现在任何输出里；
  回归测试直接断言 `.env` 里的哨兵值不会漏出来。
- **写文件钉死在工程根内**：绝对路径、`..`、非源码类型一律拒；目标在读取后被改过先拒绝，
  要覆盖得显式带 `force`。
- Skill 改名 `arenapro`，references 重写为工程结构 / `apc` 命令 / 脚本规范三份。
  `apc.md` 记了三处官方文档与 CLI 代码不一致的地方（`list` 实际 30 条、`resource` 只有短名 `-s`、
  `ui` scope 被拒）。
- 测试从 26 条扩到 **89 条**（parser 20 + kit 48 + site 21），新增假插件夹具。

## 1.1.1 — 2026-09-26

（目标已废弃，见 0.1.0）介绍页窄屏顶栏溢出修复。

## 1.1.0 — 2026-09-26

（目标已废弃）开源发布与独立介绍页。

## 1.0.1 — 2026-09-26

（目标已废弃）`install.sh` 可重复执行。

## 1.0.0 — 2026-09-26

（目标已废弃）从编辑器仓库中拆出接入层。

- ArenaPro 兼容 MCP 服务改为独立进程 + 纯 HTTP 代理；`dao3-editor` Skill 随仓库分发；
  官方 24 个工具名全部在册。
