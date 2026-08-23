import type { AcademicDocument, InlineNode } from "./document-schema";
import { parseAcademicDocument } from "./document-schema";
import { renderAcademicDocumentToLatex, type LatexReference, type LatexRenderResult } from "./latex-renderer";
import type { AcademicTemplateManifest } from "./template-registry";

export interface TemplateConformanceResult {
  status: "passed" | "needs_review";
  blockCount: number;
  nodeCount: number;
  issues: string[];
  warnings: string[];
  rendered: LatexRenderResult;
}

export function buildSampleAcademicDocument(): AcademicDocument {
  return parseAcademicDocument({
    schemaVersion: "1",
    title: "Sample Academic Document",
    blocks: [
      { kind: "paper_metadata", title: "中文论文标题 / Sample Academic Document", authors: ["殷浚航", "Sample Author"], institution: "LumenLab University", degreeType: "硕士", date: "2026" },
      { kind: "abstract", language: "zh", children: [{ kind: "text", text: "这是用于模板一致性检查的中文摘要，覆盖文档元数据和基本证据链。" }] },
      { kind: "abstract", language: "en", children: [{ kind: "text", text: "This abstract exercises bilingual metadata and deterministic rendering." }] },
      { kind: "keywords", language: "zh", keywords: ["深度研究", "论文排版", "证据"] },
      { kind: "keywords", language: "en", keywords: ["research", "paper", "evidence"] },
      { kind: "heading", id: "section-1", level: 1, children: [{ kind: "text", text: "第一章 绪论" }] },
      { kind: "heading", id: "section-1-1", level: 2, children: [{ kind: "text", text: "研究背景" }] },
      { kind: "heading", id: "section-1-1-1", level: 3, children: [{ kind: "text", text: "问题定义" }] },
      { kind: "paragraph", id: "paragraph-long", children: [{ kind: "text", text: "这是一段较长的连续正文，用于检查模板对中英文混排、脚注、行内数学、交叉引用和引用标记的稳定承载。" }, { kind: "bold", children: [{ kind: "text", text: "加粗结论" }] }, { kind: "italic", children: [{ kind: "text", text: " italic" }] }, { kind: "inline_math", latex: "E=mc^2" }, { kind: "cross_reference", targetId: "section-1" }, { kind: "citation", referenceId: "ref-sample" }, { kind: "footnote", id: "footnote-1", children: [{ kind: "text", text: "脚注内容" }] }] },
      { kind: "figure", id: "figure-1", assetId: "sample-figure", caption: "示例图片", label: "fig:sample", width: 0.72, alignment: "center", placement: "here" },
      { kind: "table", id: "table-1", columns: ["指标", "中文结果", "English result"], rows: [["覆盖率", "0.90", "0.90"], ["独立来源", "3", "3"], ["冲突", "已标注", "tracked"]], caption: "示例表格", label: "tab:sample" },
      { kind: "equation", id: "equation-1", latex: "\\mathrm{coverage}=\\frac{\\mathrm{supported\\ claims}}{\\mathrm{all\\ claims}}", label: "eq:coverage" },
      { kind: "list", id: "list-1", ordered: true, items: [[{ kind: "text", text: "确定研究问题" }], [{ kind: "text", text: "保存来源快照" }], [{ kind: "text", text: "核验引用支持关系" }]] },
      { kind: "quote", id: "quote-1", children: [{ kind: "text", text: "证据必须能够回到当时实际读取的来源版本。" }], attribution: "Research Domain" },
      { kind: "bibliography", referenceIds: ["ref-sample"] },
      { kind: "appendix", id: "appendix-a", title: "附录 A", blocks: [{ kind: "paragraph", id: "appendix-paragraph", children: [{ kind: "text", text: "附录内容" }] }] },
      { kind: "acknowledgement", children: [{ kind: "text", text: "感谢参与模板验证的研究者。" }] },
      { kind: "page_break", id: "page-break-1" },
      { kind: "raw_latex", id: "raw-latex-1", latex: "% preserved raw LaTeX block" },
    ],
  });
}

export function runTemplateConformance(input: { document?: AcademicDocument; manifest: AcademicTemplateManifest; references?: LatexReference[] }): TemplateConformanceResult {
  const document = input.document ?? buildSampleAcademicDocument();
  const rendered = renderAcademicDocumentToLatex(document, { manifest: input.manifest, references: input.references ?? [] });
  const issues: string[] = [];
  const warnings: string[] = [];
  const documentClass = input.manifest.documentClass ?? "ctexart";
  if (!rendered.mainTex.includes(`\\documentclass{${documentClass}}`)) issues.push("主文件没有使用 Manifest 声明的 documentClass");
  if (!rendered.mainTex.includes("\\input{generated-content.tex}")) issues.push("主文件没有接入 generated-content.tex");
  if (!rendered.generatedContentTex.trim()) issues.push("生成内容为空");

  const nodeIds = new Set(Object.keys(rendered.nodeMap));
  const referenceIds = new Set((input.references ?? []).map((reference) => reference.id));
  for (const node of collectInlineNodes(document)) {
    if (node.kind === "cross_reference" && !nodeIds.has(node.targetId)) issues.push(`交叉引用目标不存在：${node.targetId}`);
    if (node.kind === "citation" && !referenceIds.has(node.referenceId)) issues.push(`引用目标不存在：${node.referenceId}`);
  }
  if (!input.manifest.engine) warnings.push("Manifest 未声明编译引擎，运行时将使用通用默认值");
  if (!input.manifest.documentClass) warnings.push("Manifest 未声明 documentClass，运行时将使用 ctexart");
  if (!input.manifest.bibliography) warnings.push("Manifest 未声明 bibliography backend");
  return { status: issues.length === 0 ? "passed" : "needs_review", blockCount: document.blocks.length, nodeCount: Object.keys(rendered.nodeMap).length, issues, warnings, rendered };
}

function collectInlineNodes(document: AcademicDocument): InlineNode[] {
  return document.blocks.flatMap((block) => {
    if (!("children" in block) || !Array.isArray(block.children)) return [];
    return flattenInline(block.children as InlineNode[]);
  });
}

function flattenInline(nodes: InlineNode[]): InlineNode[] {
  return nodes.flatMap((node) => {
    if ("children" in node && Array.isArray(node.children)) return [node, ...flattenInline(node.children as InlineNode[])];
    return [node];
  });
}
