# `apc` 命令（`@box3lab/arenapro-cli`）

`apc` 是官方 CLI，现在按**分组**组织（0.7.0 起）。本包**不代跑任何要连 Creator 或出网的命令**，
只给你命令原文——判据：连 `127.0.0.1:3127` 的 Creator 服务、或访问 npm/公开 DTS 源的，都算。

> 版本差异很实际：0.5.x 是 `apc upload` / `apc login` / `VITE_DAO3_MAP_ID` 那一套；
> 0.7.0 改成分组命令 + Profile + `VITE_BOX_CREATOR_*`。
> 先跑 `apc --version` 与 `apc docs` 确认本机到底哪一版，别照这份文档硬敲。

## 命令总览

```text
apc profile add|list|test|remove     连哪台 Creator、用哪个 CLI Token
apc project create|bind|info         建工程、绑永久地图 ID、查绑定与健康状态
apc map list|resource                列地图；同步 DTS 与资源索引
apc script get|upload                读地图上的脚本；上传/覆盖一个脚本
apc storage list|get|set|delete      数据空间读写
apc runtime status|start|restart|stop|logs   控制编辑器里的 Preview Run
apc scene capture                    截当前地图画面为 PNG
apc package list                     查 @dao3fun 扩展包（只查不装）
apc docs                             输出随包发布的完整 Markdown 文档
```

## 自动化约定

- 除 `project create` 外都建议加 `--json`，**只解析标准输出的 JSON，用非零退出码当失败信号**。
- `--profile <name>` / `--project <id>` 只临时覆盖，不改写 `.env`。
- `--env [mode]` 读写 `.env.<mode>`；不传用 `.env`。**选了 mode 就不回退 `.env`。**
- 写操作（`storage delete`、`script upload`、`runtime stop`）会改 Creator 状态：
  先用读取命令确认目标，再动手。

## 首次接入一张地图

```bash
export BOX_CREATOR_TOKEN='bxc_…'                      # 或 --token，别写进 .env
apc profile add local --endpoint 127.0.0.1:3127 --token "$BOX_CREATOR_TOKEN"
apc profile test local
apc project create my-map && cd my-map
apc map list --profile local --keyword "测试"
apc project bind <permanentMapId> --profile local     # 写 VITE_BOX_CREATOR_*
apc map resource --type all                           # DTS + 资源索引
npm install && npm run dev
```

`project bind` 要的是 **永久地图 ID**（形如 `map-abc123`），不能用地图名称、临时 hash 或展示用作品 ID。
Creator 暂时不可达但 ID 已确认时才用 `--skip-verify`。

## 各命令要点

### `apc profile`

- `add <name> --endpoint <url> [--token]`：同名会更新地址；Token 存本机私密凭据，**不进工程目录**。
  局域网地址可省协议，公网必须 `https://`。
- `list`：不连服务器、不显示 Token 内容。
- `test [profile]`：查连通性并记录 Creator 实例身份；**不逐项校验业务权限**。
- `remove <name>`：删 Profile 与本机 Token，不动服务器与工程 `.env`。

### `apc map resource`

| `--type` | 做什么 | 要凭据吗 |
|---|---|---|
| `dts` | 从公开源同步两端 TypeScript 声明 | **不需要** Profile/Token |
| `assets` | 从 Creator 拉模型、图片、音频与 UI 索引（默认值） | 需要资源读取权限 |
| `all` | 先 dts 再 assets | 同上 |

`--ui-prefix <p>` 只影响生成的 UI 索引，不会删改 Creator 里的 UI。
生成文件是**派生输出**，手改会在下次同步被覆盖。

### `apc script`

- `get`（不带 entry）列共享脚本；`get <entry> --side server|client [--out <path>]` 读内容。只读。
- `upload <projectId> <side> <entry> --file <path>`：直接覆盖地图里的脚本，上限 **20 MiB**，
  成功返回 `side / entry / revision`。**不会保留旧版本**——先 `script get` 备份。
- 日常 TS 开发走 `npm run dev` / `npm run build`；只有 `VITE_UPDATE_FILE=true` 才构建后自动上传。

### `apc storage`

```bash
apc storage list player --page 0 --limit 50
apc storage get player user_123
apc storage set player user_123 --value '{"coins":100}'   # 或 --file，二选一
apc storage delete player user_123 --yes                  # 必须显式 --yes
apc storage list leaderboard --scope group
```

`--scope project|group`（默认 `project`）；`--page` 从 0 起；`--limit` 1..100，默认 50。
写入值必须是合法 JSON。`delete` 不可通过 CLI 撤销；键不存在时返回"无需删除"而不是谎报成功。

### `apc runtime`

控制的是 **Creator 编辑器里同一地图的 Preview Run**——不开浏览器、不发布游玩地图、不新建容器。

`logs` 订阅实时 SSE 控制台：`--follow`（断线每秒重连）、`--side`、`--level error|warn|info|debug`、
`--grep`、`--verbose`（完整栈）、`--raw`。CLI 会用本地 `dist/` 的 sourcemap 把部分堆栈映射回
TypeScript——**调试期别清 `dist/`**，清了就没法还原行号。

### `apc scene capture`

`--out <path>` 必填（父目录自动创建），`--view 3d|2d` 可选，省略则截完整玩家画面。
只读，但**要求目标地图已在 Creator 编辑器里打开**且 Token 有读场景权限。

## 发布前检查

```bash
npm run build
apc project info --json      # Profile / 永久地图 ID / Token 是否配置 / Creator 健康 / Node 版本
apc runtime status --json
```

## CI

`BOX_CREATOR_TOKEN` 走 CI Secret 注入，**绝不写进工程 `.env`、`.env.example`、代码或日志**。
只上传脚本的流水线通常只需要 `scripts.update` 权限，别顺手给数据空间或运行控制权限。
