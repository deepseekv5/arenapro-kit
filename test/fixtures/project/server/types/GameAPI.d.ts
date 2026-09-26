/**
 * @zh
 * 游戏世界的主要接口。
 * @en
 * Main world interface.
 */
declare class GameWorld {
  /**
   * @zh 实体的最大数量。
   * @en Maximum number of entities.
   */
  entityQuota: number;

  /**
   * @zh
   * 向所有玩家广播一条消息。
   * @en
   * Broadcasts a message to all players.
   * @param message
   * @zh 要广播的文本消息。
   * @en The text message to broadcast.
   * @category Player
   */
  say: (message: string) => void;

  /**
   * @zh 播放一段音效。
   * @en Plays an audio sample.
   */
  sound: (
    spec:
      | {
          /**
           * @zh 音频样本的名称。
           */
          sample: string;
          /**
           * @zh 声音的播放位置。
           */
          position: GameVector3;
        }
      | string
  ) => void;
}

declare class GameVector3 {
  /**
   * @zh 向量的 x 分量。
   */
  x: number;
  private constructor();
  /**
   * @zh 返回一个绕轴旋转的角度。
   * @link https://docs.dao3.fun/arenapro/
   */
  getAxisAngle(_q: GameQuaternion): {
    angle: number;
    axis: GameVector3;
  };
  toString(): string;
}

declare const console: {
  /**
   * @zh 在控制台输出日志信息。
   */
  log: (...args: any[]) => void;
};

/**
 * @zh 四元数。顺序是 x, y, z, w。
 */
declare class GameQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
  constructor(x?: number, y?: number, z?: number, w?: number);
}

declare type GameLoggerMethod = (...args: any[]) => void;
declare function sleep(ms: number): Promise<void>;

/**
 * @zh
 * 本地图的世界入口。
 */
declare const world: GameWorld;

/**
 * @zh
 * 数据存储空间入口。
 */
declare const storage: GameStorage;
