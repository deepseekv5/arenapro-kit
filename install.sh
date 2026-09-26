#!/usr/bin/env bash
# 把 arenapro Skill 装进某个工程的 .qoder/skills/。
#
# 默认用**软链**：改这份仓库，所有装了它的工程立刻跟着变——
# 这类"给 AI 的规范"最容易出现的就是各处副本各自漂移。
# 要把副本真正落盘（比如要提交进那个工程、或跨机器同步），加 --copy。
#
#   ./install.sh                      # 软链到当前工程 .qoder/skills/
#   ./install.sh /path/to/project     # 软链到指定工程
#   ./install.sh --copy [目标]        # 复制而不是软链
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skill/arenapro"
MODE="link"
DEST=""
for a in "$@"; do
  case "$a" in
    --copy) MODE="copy" ;;
    --link) MODE="link" ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) DEST="$a" ;;
  esac
done
[ -n "$DEST" ] || DEST="$PWD"

TARGET_DIR="$DEST/.qoder/skills"
TARGET="$TARGET_DIR/arenapro"
mkdir -p "$TARGET_DIR"

if [ -L "$TARGET" ] && [ "$(readlink "$TARGET")" = "$SRC" ]; then
  echo "已安装，指向一致：$TARGET -> $SRC"
  exit 0
fi

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  echo "已存在：$TARGET"
  if [ -L "$TARGET" ]; then
    echo "它现在指向 $(readlink "$TARGET")，不是本仓库。"
    echo "确认要换成本仓库就执行：ln -sfn '$SRC' '$TARGET'"
  else
    echo "那是一份实体副本，不覆盖。确认要重装就先 rm -rf "$TARGET"。"
  fi
  exit 1
fi

if [ "$MODE" = "copy" ]; then
  cp -R "$SRC" "$TARGET"
  echo "已复制到 $TARGET"
else
  ln -s "$SRC" "$TARGET"
  echo "已软链 $TARGET -> $SRC"
fi

echo
echo "下一步："
echo "  1.（可选）起 MCP 端点：  node $(cd "$(dirname "$0")" && pwd)/mcp/server.mjs --project <你的 ArenaPro 工程>"
echo "     官方 ArenaPro 插件在跑就自动透传它的工具；不在跑也不影响本地工具。"
echo "  2. 重启会话或 /skills reload，然后 /arenapro"
echo
echo "验证： node $(cd "$(dirname "$0")" && pwd)/skill/arenapro/scripts/arenapro.mjs info --project <你的 ArenaPro 工程>"
