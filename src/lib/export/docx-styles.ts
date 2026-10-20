import type { IStylesOptions } from "docx";

/** Explicit East Asian font/language for Word, Pandoc and the JS fallback. */
export const DOCX_CHINESE_FONT = "Noto Sans SC";

export function chineseDocxStyles(): IStylesOptions {
  const heading = (size: number, outlineLevel: number) => ({
    run: { font: DOCX_CHINESE_FONT, size, bold: true, color: "222222" },
    paragraph: { spacing: { before: 280, after: 160 }, outlineLevel, keepNext: true },
  });
  return {
    default: {
      document: {
        run: { font: DOCX_CHINESE_FONT, size: 22, language: { value: "en-US", eastAsia: "zh-CN" } },
        paragraph: { spacing: { line: 360, after: 160 } },
      },
      title: { run: { font: DOCX_CHINESE_FONT, size: 36, bold: true } },
      heading1: heading(32, 0),
      heading2: heading(28, 1),
      heading3: heading(24, 2),
      heading4: heading(24, 3),
      heading5: heading(22, 4),
      heading6: heading(22, 5),
    },
  };
}
