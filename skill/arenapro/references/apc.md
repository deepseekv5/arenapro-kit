# `apc` 命令（`@box3lab/arenapro-cli`）

`apc` 是官方 CLI。**本包不代跑其中任何联网命令**——需要时只给你命令原文。

判据很简单：碰 `code-api-pc.dao3.fun` / `dao3.fun` / npm registry 的都联网。

| 命令 | 别名 | 联网 | 做什么 |
|---|---|---|---|
| `apc login` | `l` | 是（开浏览器授权） | 拿账号 Token，写全局配置或指定 env |
| `apc list` | — | 是 | 列当前账号的扩展地图，并缓存到全局 |
| `apc set [keyword]` | — | 否（查本地缓存） | 把某张地图写进 `.env` 的 `VITE_DAO3_*` |
| `apc resource` | `r` | 是 | 从地图同步资源与类型声明（d.ts、UiIndex） |
| `apc upload [target]` | `u` | 是 | 把 `dist/` 里的脚本传到地图 |
| `apc preview [mode]` | `p` | 是（开浏览器） | 打开创作页；带任意参数打开游玩页 |
| `apc create <name>` | `c` | 否 | 用官方脚手架建工程 |
| `apc info` | `i` | 否 | 看登录态、地图绑定、Node/npm/git、env 文件清单 |
| `apc npmlist` | `nl` | 是 | 列 `@dao3fun` 组织下的包 |

通用选项：`-e, --env [mode]` 选 env 文件（不带值 = `.env`，带值 = `.env.<mode>`）。

## 三处"文档与代码不一致"

以代码为准，这三条最容易让人按文档写完发现不生效：

1. **`apc list` 的条数**：描述说最近 100 张，实际请求体是 `limit: 30`。
   要更多只能靠 `--keyword` 过滤，别指望它列全。
2. **`apc resource` 的 scope 只有短名 `-s`**：文档写着 `-s, --scope`，代码里只注册了 `-s`。
   写 `--scope assets` 不会被认出来。取值 `all | api | assets`。
3. **`ui` scope 会被拒**：内核类型里有 `ui`，但命令层只放行 `all|api|assets`。
   想更新 UI 索引就跑完整的 `apc resource`。

## 常用组合

```bash
# 第一次接工程
apc login                     # 浏览器里授权
apc create my-map && cd my-map
apc set 100005475             # 绑定地图（也可用名称 / playHash）
apc resource                  # 拉类型声明与资源

# 日常改代码
npm run build && apc upload
apc preview play              # 看线上效果

# 只想让类型变新，不拉资源
apc resource -s api
```

## 授权流程的两件事

- 回调固定在 **`http://localhost:25320/auth/callback`**，没有端口回退——25320 被占就登不上。
- 先 `apc login` 成功、才回写配置。`apc set` 依赖 `apc list` 写下的本地缓存，
  所以**没跑过 `apc list` 时 `apc set <名称>` 搜不到东西**，这不是 bug。

## 上传的行为细节

- 目标省略时按 `server → client` 顺序两端都传。
- 只扫 `dist/<端>` 单层，只认 `js|cjs|mjs`，统一按 `.js` 上传。
- 任何一个文件失败就整体退出非 0，剩下的不传。
- `--dir` 可以换上传目录（多 bundle / 自定义输出时用）。
