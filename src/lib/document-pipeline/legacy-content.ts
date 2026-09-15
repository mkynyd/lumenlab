import { extensionOf } from "./parsers/utils";

/**
 * 0.3.0 之前写入的解析结果带着写库前的转义（`\*\*粗体\*\*`、`\\frac`），
 * 展示出来就是一堆裸露的星号与反斜杠。重新解析能给到干净内容，但 PDF 与
 * Office 要重新调用解析服务，存量文件又多，所以展示层先做一次等价还原：
 * 旧转义是我们自己的 `escapeMarkdown`/`escapeFormula` 加的，可以精确逆转。
 *
 * 纯文本类（txt/csv/json）不走这条路——它们在新管线里本来就该被转义，
 * 还原反而会把字面星号变成 Markdown 语法。
 */

/** 新管线开始产出未转义内容的版本；低于它的解析结果需要还原。 */
export const UNESCAPED_CONTENT_SINCE = "0.3.0";

const LITERAL_TEXT_EXTENSIONS = new Set(["txt", "csv", "json"]);

function parseVersion(value: string): number[] | null {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return parts;
}

function isOlderThan(version: string, threshold: string): boolean {
  const left = parseVersion(version);
  const right = parseVersion(threshold);
  if (!left || !right) return false;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

export function needsLegacyUnescape(input: {
  originalName: string;
  mimeType: string;
  pipelineVersion?: string | null;
  hasTextContent: boolean;
}): boolean {
  if (!input.hasTextContent) return false;
  if (input.mimeType.startsWith("image/")) return false;
  if (LITERAL_TEXT_EXTENSIONS.has(extensionOf(input.originalName))) return false;
  const version = input.pipelineVersion;
  // 没有版本号说明比任何带版本号的都早。
  if (!version) return true;
  return isOlderThan(version, UNESCAPED_CONTENT_SINCE);
}

/**
 * 逆转 `escapeMarkdown`（`\*\*` → `**`）与 `escapeFormula`（`\\frac` → `\frac`）
 * 加上的反斜杠，并把紧贴的块级公式定界符摊开——`$$\begin{aligned}` 会让
 * remark-math 把命令连同定界符一起吃掉。
 */
export function unescapeLegacyParsedMarkdown(content: string): string {
  const unescaped = content.replace(/\\([\\`*_{}[\]()#|])/g, "$1");
  return unescaped.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_match, inner: string) => `$$\n${inner.trim()}\n$$`
  );
}
