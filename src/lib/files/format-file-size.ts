/**
 * 客户端安全的文件大小格式化（对照 HeroUI formatChatAttachmentSize）。
 * 供聊天附件卡片、Composer 预览条等浏览器侧代码使用；null/undefined/负数返回空串。
 */
export function formatFileSize(bytes?: number | null): string {
  if (bytes == null || Number.isNaN(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[unit]}`;
}
