# ArenaPro 工程结构

官方文档自己就写着"不同版本的脚手架目录可能略有差异"——**以 `project_info` 读到的实际结构为准**，
不要拿这份文档当模板去新建目录。

## 典型目录

```
<工程根>
├─ dao3.config.ts          bundles 与两端入口
├─ vite.config.ts          Vite 入口（含 ArenaPro 相关插件）
├─ tsconfig.base.json      被 client/server 各自的 tsconfig 继承
├─ env.d.ts
├─ package.json
├─ .env / .env.example     凭据与地图绑定
├─ client/
│  ├─ src/App.ts           客户端入口
│  ├─ types/ClientAPI.d.ts 客户端可用 API 的类型声明
│  └─ UiIndex/             apc resource 生成的 UI 节点索引
├─ server/
│  ├─ src/App.ts           服务端入口
│  └─ types/GameAPI.d.ts   服务端可用 API 的类型声明
├─ shares/                 两端共享代码，尽量保持无平台依赖
│  └─ types/GameAssets.d.ts
├─ i18n/                   多语言：index.ts、types/i18n.d.ts、res/<lang>/translation.json
└─ .vscode/                settings / extensions / launch / tasks
```

`shares/` 的推荐做法是不直接依赖只存在于某一端的 API——需要平台相关的部分就用参数注入隔开。

TS 别名（工程侧要保住）：`@src/*`、`@shares/*`、`@server/*`、`@client/*`、`@root/*`，
`typeRoots: ["./types"]`。

## dao3.config.ts

只有一个字段 `bundles`，每个 bundle 指定两端入口（相对 `client/src` / `server/src`）与开关：

```ts
import type { IDao3Config } from 'vite-plugin-arenapro-script';

export default {
  bundles: {
    bundle: {
      client: { entry: 'App.ts' },
      server: { entry: 'App.ts' },
      enable: true,
    },
  },
} as IDao3Config;
```

`enable: false` 的 bundle 会被跳过；`.env` 里 `VITE_CURRENT_FILE=<名字>` 时只构建那一个。

## env 键

CLI 自己按行解析 env：`KEY=VALUE`、`#` 注释、**不去引号、不做插值、不合并多个文件**。
`--env dev` 就只读 `.env.dev`，**不会回退到 `.env`**——这点最容易踩。

| 键 | 用途 | 敏感 |
|---|---|---|
| `VITE_DAO3_MAP_ID` | 目标地图 ID（必须是扩展地图） | 否 |
| `VITE_DAO3_MAP_NAME` | 地图名，仅作参考 | 否 |
| `VITE_DAO3_PLAY_HASH` / `VITE_DAO3_EDIT_HASH` | 游玩 / 创作页 hash | 否 |
| `VITE_DAO3_AUTH` | 账号 Token | **是** |
| `VITE_DAO3_UA` | 账号 User-Agent | **是** |
| `VITE_UPDATE_FILE` | 构建后是否自动上传 | 否 |
| `VITE_CURRENT_FILE` | 只构建指定 bundle | 否 |
| `VITE_UI_INDEX_PREFIX` | 按节点名前缀筛 UI 元素 | 否 |

优先级：本地 env > 全局配置。例外是 `apc info` 显示的"本地"值取自 `process.env`，不是 env 文件。

## 构建与上传链

```
npm run build   →   dist/server/<bundle>.server.js  +  dist/client/<bundle>.client.js
                →   apc upload                       （上传到神岛地图）
```

- server 端产物是 **cjs / node16**，client 端是 **esm / esnext**；`emptyOutDir` 会清空 `dist`。
- 上传只扫 `dist/server` 与 `dist/client` 的**单层**目录，只认 `js|cjs|mjs`，
  上传时统一改成 `.js` 后缀。子目录里的文件会被静默忽略——这是"我改了但线上没变"的常见根因。
- 任一文件上传失败立即终止并非 0 退出，不会继续传剩下的。
- 想构建后自动上传：配 `vite-plugin-arenapro-script`（`VITE_UPDATE_FILE=true`）。

## 全局配置目录

`apc login` 不带 `--env` 时写全局，位置由包名 `arenapro-cli` 决定：

- macOS：`~/Library/Preferences/arenapro-cli-nodejs/{auth.json,ugc-maps.json}`
- Windows：`%APPDATA%\arenapro-cli-nodejs\Config\`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/arenapro-cli-nodejs/`

`auth.json` 是 `{authToken, userAgent}`，`ugc-maps.json` 是 `apc list` 缓存的地图表。
**本包不读这些文件**——需要凭据的动作一律交回 `apc`。
