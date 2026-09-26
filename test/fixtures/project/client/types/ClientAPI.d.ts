/**
 * @zh 客户端 UI 文本节点。
 */
declare class UiText {
  /**
   * @zh 文本内容。
   */
  textContent: string;
  /**
   * @zh 字号。
   */
  textFontSize: number;
}

declare const ui: {
  /**
   * @zh 按节点路径查找 UI 节点。
   */
  findNodeByName: (name: string) => UiText | null;
};
