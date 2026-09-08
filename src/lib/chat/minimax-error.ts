/**
 * MiniMax 供应商错误归一。旧的 Anthropic 流式实现（streamMiniMaxChat）已随
 * 任务 03 删除：流式聊天由 MiniMaxAdapter 唯一接入 Responses，非流式复用
 * postResponses；错误映射保留供 runtime 归一供应商状态码。
 */
export class MiniMaxChatError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "MiniMaxChatError";
  }
}
