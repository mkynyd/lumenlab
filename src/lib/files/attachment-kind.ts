/**
 * 附件展示类别：客户端乐观 DTO 与服务端持久化行共用同一推断规则，
 * 保证乐观消息与历史消息渲染一致。
 */
export type AttachmentKind = "image" | "video" | "file";

export function attachmentKindFromMimeType(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}
