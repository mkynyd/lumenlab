import { Document, FootnoteReferenceRun, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import AdmZip from "adm-zip";

/** Deterministic bilingual fixture used by isolated DOCX/Markdown formatting validation. */
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

export const FORMATTING_FIXTURE_METADATA = {
  title: "排版验证样例论文",
  authors: ["殷浚航", "样例作者"],
  institution: "LumenLab 大学",
  degreeType: "硕士",
  studentId: "20260001",
  department: "计算机学院",
  major: "计算机科学与技术",
  supervisor: "样例导师",
  date: "2026-06",
};

export const FORMATTING_MARKDOWN_FIXTURE = [
  "# 摘要",
  "",
  "这是 Markdown 原稿的中文摘要，用于验证模板对中文正文、行内公式 $E=mc^2$ 与结构映射的承载。",
  "",
  "# Abstract",
  "",
  "This English abstract exercises deterministic Markdown import and template rendering.",
  "",
  "# 第一章 绪论",
  "",
  "## 研究背景",
  "",
  "正文段落包含 **加粗结论**、*斜体说明* 与行内公式 $a^2+b^2=c^2$，并带有一个脚注[^note]。",
  "",
  "$$",
  "\\mathrm{coverage}=\\frac{\\mathrm{supported\\ claims}}{\\mathrm{all\\ claims}}",
  "$$",
  "",
  "| 指标 | 中文结果 | English result |",
  "| --- | --- | --- |",
  "| 覆盖率 | 0.90 | 0.90 |",
  "| 独立来源 | 3 | 3 |",
  "",
  "> 证据必须能够回到当时实际读取的来源版本。",
  "",
  "1. 确定研究问题",
  "2. 保存来源快照",
  "3. 核验引用支持关系",
  "",
  "[^note]: Markdown 脚注内容。",
  "",
  "---",
  "",
  "## 致谢",
  "",
  "感谢参与模板验证的研究者。",
  "",
].join("\n");

/** OMML is injected after packing because the docx package has no math API. */
const OMML_EQUATION = '<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMath><m:f><m:num><m:r><m:t>coverage</m:t></m:r></m:num><m:den><m:r><m:t>claims</m:t></m:r></m:den></m:f></m:oMath></m:oMathPara>';

export async function buildFormattingDocxFixture(): Promise<Buffer> {
  const document = new Document({
    footnotes: { 1: { children: [new Paragraph({ children: [new TextRun("DOCX 脚注内容。")] })] } },
    sections: [{
      children: [
        new Paragraph({ text: "摘要", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun("这是 DOCX 原稿的中文摘要，用于验证模板对中文正文、脚注与结构映射的承载"), new FootnoteReferenceRun(1), new TextRun("。")] }),
        new Paragraph({ text: "Abstract", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun("This English abstract exercises deterministic DOCX import and template rendering.")] }),
        new Paragraph({ text: "第一章 绪论", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: "研究背景", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ children: [new TextRun({ text: "正文段落包含加粗结论。", bold: true }), new TextRun({ text: " 斜体说明。", italics: true })] }),
        new Paragraph({ children: [new ImageRun({ type: "png", data: ONE_PIXEL_PNG, transformation: { width: 40, height: 40 }, altText: { title: "示例图片", description: "示例图片", name: "sample-figure" } })] }),
        new Table({
          rows: [
            new TableRow({ children: ["指标", "中文结果", "English result"].map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
            new TableRow({ children: ["覆盖率", "0.90", "0.90"].map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
            new TableRow({ children: ["独立来源", "3", "3"].map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
          ],
        }),
      ],
    }],
  });
  const packed = await Packer.toBuffer(document);
  const archive = new AdmZip(packed);
  const entry = archive.getEntry("word/document.xml");
  if (!entry) throw new Error("DOCX fixture 缺少 document.xml");
  const xml = entry.getData().toString("utf8");
  const paragraph = `<w:p><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${OMML_EQUATION.slice(OMML_EQUATION.indexOf("<m:oMath>"), OMML_EQUATION.lastIndexOf("</m:oMathPara>"))}</m:oMathPara></w:p>`;
  const injected = xml.replace("</w:body>", `${paragraph}</w:body>`);
  if (injected === xml) throw new Error("DOCX fixture 注入公式失败");
  archive.updateFile("word/document.xml", Buffer.from(injected, "utf8"));
  return archive.toBuffer();
}
