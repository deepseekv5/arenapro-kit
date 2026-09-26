/**
 * 计分板 + 建图助手（服务端脚本）
 *
 * 放进 ArenaPro 工程的 server/src/App.ts，或贴进 Creator 的服务端脚本里都能用。
 * 里面每一个引擎成员都在官方 server/types/GameAPI.d.ts 里查得到——
 * test/example.test.mjs 会再对一遍，因为**编出来的接口能过语法检查、能跑起来，
 * 然后运行时静默什么都不做**，那是最难查的一类 bug。
 *
 * 指令（打在聊天框里，前缀 !）：
 *   !help  说明        !pos  我的坐标      !加   记一分
 *   !me    我的分数    !top  排行榜前 5    !reset 清掉我的分
 */

/** 榜单存储：key 是玩家名，value 是分数。 */
const board = storage.getDataStorage<number>("scoreboard");

/** 同一玩家两条指令之间的最小间隔，防刷屏。 */
const COOLDOWN_MS = 400;
const lastCommandAt = new Map<string, number>();

const HELP = "!help 说明 · !pos 我的坐标 · !加 记一分 · !me 我的分数 · !top 排行榜 · !reset 清掉我的分";

/** 聊天事件的 entity 一定是 GameEntity；只有玩家才有 .player。 */
function nameOf(entity: GameEntity): string {
  return entity.player ? entity.player.name : "无名实体";
}

world.onPlayerJoin(({ entity }) => {
  const online = world.querySelectorAll("player").length;
  world.say(`${nameOf(entity)} 加入了，当前 ${online} 人在线`);
  if (entity.player) entity.player.directMessage(`可用指令：${HELP}`);
});

world.onPlayerLeave(({ entity }) => {
  const online = world.querySelectorAll("player").length;
  world.say(`${nameOf(entity)} 离开了，剩余 ${online} 人在线`);
});

/**
 * 排行榜。
 * list 只有 cursor 必填，其余可选；返回的 QueryList 要一页页 nextPage() 往后翻。
 * 这里最多翻 5 页，避免榜单很大时一条指令吃掉整个 tick 之后的时间。
 */
async function topScores(limit: number): Promise<Array<{ key: string; value: number }>> {
  const collected: Array<{ key: string; value: number }> = [];
  const page = await board.list({ cursor: 0, pageSize: 100 });
  let guard = 0;

  for (;;) {
    for (const row of page.getCurrentPage()) {
      if (row && typeof row.value === "number") collected.push({ key: row.key, value: row.value });
    }
    if (page.isLastPage || guard++ >= 5) break;
    await page.nextPage();
  }

  collected.sort((a, b) => b.value - a.value);
  return collected.slice(0, limit);
}

world.onChat(async ({ entity, message }) => {
  const text = String(message).trim();
  if (text.charAt(0) !== "!") return;          // 不是指令就别拦正常聊天

  const player = entity.player;
  if (!player) return;                          // 非玩家实体发的，忽略

  const now = Date.now();
  if (now - (lastCommandAt.get(player.name) || 0) < COOLDOWN_MS) return;
  lastCommandAt.set(player.name, now);

  const cmd = text.slice(1).toLowerCase();
  const tell = (line: string) => player.directMessage(line);

  if (cmd === "help") return tell(HELP);

  if (cmd === "pos") {
    const p = entity.position;
    return tell(`坐标 x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
  }

  if (cmd === "加" || cmd === "score") {
    // increment 是原子的：两个人同一 tick 各加一分不会互相覆盖。
    const total = await board.increment(player.name, 1);
    return tell(`已记 1 分，你的总分 ${total}`);
  }

  if (cmd === "me") {
    const row = await board.get(player.name);
    return tell(row ? `你的分数：${row.value}` : "你还没有分数，发 !加 记一分");
  }

  if (cmd === "top") {
    const rows = await topScores(5);
    if (!rows.length) return tell("还没有人得分");
    const lines = rows.map((r, i) => `${i + 1}. ${r.key}  ${r.value}`);
    return tell(`排行榜：\n${lines.join("\n")}`);
  }

  if (cmd === "reset") {
    await board.remove(player.name);
    return tell("你的分数已清零");
  }

  return tell(`没这条指令。${HELP}`);
});

world.say("计分板已就绪，发 !help 看指令");
