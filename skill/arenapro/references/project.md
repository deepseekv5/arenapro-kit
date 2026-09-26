# ArenaPro / Creator 工程结构

官方文档自己就写着"不同版本的脚手架目录可能略有差异"——**以 `project_info` 读到的实际结构为准**。
CLI 0.5.x 与 0.7.0 的 env 键名不同，这份文档以 0.7.0 为主，末尾列出旧键名供对照。

## 典型目录

```
<工程根>
├─ dao3.config.ts          bundles 与两端入口
├─ vite.config.ts          Vite 入口（含 ArenaPro 相关插件）
├─ tsconfig.base.json      被 client/server 各自的 tsconfig 继承
├─ env.d.ts
├─ package.json
├─ .env / .env.example     工程绑定与构建行为（不含 Token）
├─ client/
│  ├─ src/App.ts           客户端入口
│  ├─ types/ClientAPI.d.ts 客户端可用 API 的类型声明
│  └─ UiIndex/             apc map resource 生成的 UI 节点索引
├─ server/
│  ├─ src/App.ts           服务端入口
│  └─ types/GameAPI.d.ts   服务端可用 API 的类型声明
├─ shares/                 两端共享代码，尽量保持无平台依赖
│  └─ types/GameAssets.d.ts
├─ i18n/                   多语言：index.ts、types/i18n.d.ts、res/<lang>/translation.json
└─ .vscode/                settings / extensions / launch / tasks
```

`shares/` 里别直接引用只存在于某一端的全局——需要平台相关的部分用参数注入隔开。

TS 别名（工程侧要保住）：`@src/*`、`@shares/*`、`@server/*`、`@client/*`、`@root/*`，
`typeRoots: ["./types"]`。

## dao3.config.ts

只有一个字段 `bundles`，每个 bundle 指定两端入口（相对 `client/src` / `server/src`）与开关：

```ts
import type { IBoxCreatorConfig } from "vite-plugin-arenapro-script";

export default {
  bundles: {
    main: {
      client: { entry: "App.ts" },
      server: { entry: "App.ts" },
      enable: true,
    },
  },
} satisfies IBoxCreatorConfig;
```

- 0.5.x 里这个类型叫 `IDao3Config`、用 `as` 断言；0.7.0 是 `IBoxCreatorConfig` + `satisfies`。
  两种形状一样，本包都认。
- bundle 名要和 `.env` 的 `VITE_CURRENT_FILE` 对得上；留空则构建所有 `enable: true` 的 bundle。
- 多玩法/多地图就多加 bundle，切 `VITE_CURRENT_FILE` 换构建目标。

## env 键（0.7.0）

**Token 不在这里。** CLI Token 走 `BOX_CREATOR_TOKEN` 环境变量或 Profile 的本机凭据；
这些键带 `VITE_` 前缀，Vite 会把它们暴露给客户端脚本，所以官方明确要求
`.env` / `.env.example` / `env.d.ts` 里**不要**放 endpoint、Token、密码。

| 键 | 用途 | 敏感 |
|---|---|---|
| `VITE_BOX_CREATOR_PROFILE` | 用哪个 Creator Profile（Profile 里存服务地址） | 否 |
| `VITE_BOX_CREATOR_PROJECT_ID` | 永久地图 ID（`apc project bind` 写入） | 否 |
| `VITE_CURRENT_FILE` | 只构建指定 bundle | 否 |
| `VITE_UPDATE_FILE` | **严格为 `true`** 才构建后上传 | 否 |
| `VITE_BOX_CREATOR_VERSION` | `true` 时远程脚本名追加 `package.json` 版本 | 否 |
| `VITE_UI_INDEX_PREFIX` | 生成 UI 索引的节点名前缀过滤 | 否 |

CLI 自己按行解析 env：`KEY=VALUE`、`#` 注释、**不去引号、不做插值、不合并多个文件**。
`--env dev` 就只读 `.env.dev`，**不会回退到 `.env`**——这点最容易踩。

### 旧版（0.5.x）键名对照

| 0.5.x | 0.7.0 |
|---|---|
| `VITE_DAO3_MAP_ID` | `VITE_BOX_CREATOR_PROJECT_ID`（且值从数字 ID 变成 `map-…` 永久 ID） |
| `VITE_DAO3_AUTH` / `VITE_DAO3_UA` 写进 `.env` | 移到 `BOX_CREATOR_TOKEN` / Profile 本机凭据，**不再进 `.env`** |
| `VITE_DAO3_PLAY_HASH` / `_EDIT_HASH` / `_MAP_NAME` | 由 `apc map list` / `project info` 提供，不再落 `.env` |

本包对两套键名都识别，并且**任何情况下都不打印**匹配 `AUTH|UA|TOKEN|SECRET|PASSWORD` 的值。

## Creator 服务地址

`apc profile add local --endpoint 127.0.0.1:3127`——桌面版 Creator 在本地 **3127**，
登录走 3125。这是"连本机应用"，不是公网；但本包仍然不直连它，读写都交给 `apc`。

## 构建与上传链

```
npm run build   →   dist/server/<bundle>.server.js  +  dist/client/<bundle>.client.js
                →   VITE_UPDATE_FILE=true 时构建后自动上传
                →   或显式 apc script upload <projectId> <side> <entry> --file …
```

- server 端产物是 **cjs / node16**，client 端是 **esm / esnext**；`emptyOutDir` 会清空 `dist`。
- 自动上传只扫 `dist/server` 与 `dist/client` 的**单层**目录，只认 `js|cjs|mjs`，
  统一按 `.js` 上传。子目录里的文件会被静默忽略——这是"我改了但线上没变"的常见根因。
- 任一文件失败立即终止并非 0 退出，剩下的不传。
- `apc runtime logs` 靠本地 `dist/` 的 sourcemap 把堆栈映射回 TypeScript，调试期别清它。

## Profile 凭据存哪

`apc profile add` 的 Token 存在**本机私密凭据**里（不在工程目录），`apc profile list` 不显示其内容。
旧版 0.5.x 的全局配置在 `env-paths('arenapro-cli').config`（macOS
`~/Library/Preferences/arenapro-cli-nodejs/{auth.json,ugc-maps.json}`）。
**本包不读这些文件**——需要凭据的动作一律交回 `apc`。
