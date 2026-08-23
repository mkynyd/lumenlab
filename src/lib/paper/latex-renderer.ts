import type { AcademicDocument, DocumentBlock, InlineNode } from "./document-schema";
import type { AcademicTemplateManifest } from "./template-registry";
import { resolveTemplateClassOptions } from "./template-snapshot";

export interface LatexReference {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
}

export interface LatexRenderResult {
  mainTex: string;
  generatedContentTex: string;
  referencesBib: string;
  nodeMap: Record<string, { line: number; kind: string }>;
}

export function renderAcademicDocumentToLatex(document: AcademicDocument, options: { manifest?: AcademicTemplateManifest; references?: LatexReference[]; assetPaths?: Record<string, string> } = {}): LatexRenderResult {
  const nodeMap: Record<string, { line: number; kind: string }> = {};
  const manifest = options.manifest;
  const documentClass = /^[A-Za-z][A-Za-z0-9_-]*$/.test(manifest?.documentClass ?? "") ? manifest!.documentClass! : "ctexart";
  const classOptions = resolveTemplateClassOptions(manifest ?? { degreeType: null }, documentClass);
  const metadata = document.blocks.find((block): block is Extract<DocumentBlock, { kind: "paper_metadata" }> => block.kind === "paper_metadata");
  const usesBiber = /biber|biblatex/i.test(manifest?.bibliography ?? "");
  const usesTemplateBiblatex = usesBiber || isBiblatexTemplateClass(documentClass);
  const lines = [
    `\\documentclass${classOptions.length > 0 ? `[${classOptions.join(",")}]` : ""}{${documentClass}}`,
    "\\usepackage{amsmath,graphicx,booktabs,hyperref}",
    ...(usesBiber && !isBiblatexTemplateClass(documentClass) ? [`\\usepackage[backend=biber,style=${biblatexStyle(documentClass)}]{biblatex}`, "\\addbibresource{references.bib}"] : []),
    ...(metadata ? renderTemplateMetadataSetup(metadata, documentClass, usesTemplateBiblatex) : []),
    "\\begin{document}",
  ];
  const generated: string[] = [];
  for (const block of document.blocks) {
    const startLine = lines.length + generated.length + 1;
    const blockText = renderBlock(block, options.assetPaths, manifest, usesTemplateBiblatex);
    generated.push(blockText);
    const id = "id" in block && typeof block.id === "string" ? block.id : block.kind;
    nodeMap[id] = { line: startLine, kind: block.kind };
  }
  lines.push("\\input{generated-content.tex}", "\\end{document}");
  return {
    mainTex: `${lines.join("\n")}\n`,
    generatedContentTex: `${generated.join("\n\n")}\n`,
    referencesBib: (options.references ?? []).map(toBibtex).join("\n\n") + (options.references?.length ? "\n" : ""),
    nodeMap,
  };
}

function bibtexField(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[{}]/g, "").replace(/([\\])/g, "\\$1");
}

function toBibtex(reference: LatexReference): string {
  const authors = reference.authors.length > 0 ? reference.authors.map(bibtexField).join(" and ") : "Unknown";
  const fields = [
    `  title = {${bibtexField(reference.title)}}`,
    `  author = {${authors}}`,
    ...(reference.year ? [`  year = {${reference.year}}`] : []),
    ...(reference.venue ? [`  journal = {${bibtexField(reference.venue)}}`] : []),
    ...(reference.doi ? [`  doi = {${bibtexField(reference.doi)}}`] : []),
    ...(reference.url ? [`  url = {${bibtexField(reference.url)}}`] : []),
  ];
  return `@article{${bibtexField(reference.id)},\n${fields.join(",\n")}\n}`;
}

function renderBlock(block: DocumentBlock, assetPaths?: Record<string, string>, manifest?: AcademicTemplateManifest, usesTemplateBiblatex = false): string {
  switch (block.kind) {
    case "paper_metadata":
      return (manifest?.documentClass ?? "").toLowerCase() === "ccnuthesis"
        ? "\\frontmatter"
        : isSpecialMetadataClass(manifest?.documentClass)
          ? "\\maketitle"
          : `\\title{${escapeLatex(block.title)}}\n\\author{${block.authors.map(escapeLatex).join(" \\and ")}}\n\\maketitle`;
    case "abstract":
      return renderAbstractBlock(block, manifest?.documentClass);
    case "keywords":
      return `\\textbf{关键词：}${block.keywords.map(escapeLatex).join("；")}`;
    case "heading":
      return `\\${sectionCommand(block.level)}{${renderInline(block.children)}}\\label{${escapeLatex(block.id)}}`;
    case "paragraph":
      return renderInline(block.children);
    case "figure":
      return `\\begin{figure}[${block.placement === "here" ? "h" : block.placement === "top" ? "t" : block.placement === "bottom" ? "b" : "htbp"}]\n\\centering\n\\includegraphics[width=${block.width ?? 0.85}\\textwidth]{${assetPaths?.[block.assetId] ?? `assets/${escapeLatex(block.assetId)}`}}\n\\caption{${escapeLatex(block.caption)}}${block.label ? `\n\\label{${escapeLatex(block.label)}}` : ""}\n\\end{figure}`;
    case "table":
      return renderTable(block);
    case "equation":
      return `\\begin{equation}\n${block.latex}\n\\end{equation}${block.label ? `\\label{${escapeLatex(block.label)}}` : ""}`;
    case "list":
      return `\\begin{${block.ordered ? "enumerate" : "itemize"}}\n${block.items.map((item) => `\\item ${renderInline(item)}`).join("\n")}\n\\end{${block.ordered ? "enumerate" : "itemize"}}`;
    case "quote":
      return `\\begin{quote}\n${renderInline(block.children)}${block.attribution ? `\\par\\hfill—${escapeLatex(block.attribution)}` : ""}\n\\end{quote}`;
    case "bibliography":
      return usesTemplateBiblatex ? "\\printbibliography" : "\\bibliography{references}\n\\bibliographystyle{plain}";
    case "appendix":
      return `\\appendix\n\\section{${escapeLatex(block.title)}}`;
    case "acknowledgement":
      return `\\section*{致谢}\n${renderInline(block.children)}`;
    case "page_break":
      return "\\clearpage";
    case "raw_latex":
      return block.latex;
  }
}

function isBiblatexTemplateClass(documentClass: string | null | undefined): boolean {
  return ["ccnuthesis", "seuthesiy", "shtthesis"].includes((documentClass ?? "").toLowerCase());
}

function isSpecialMetadataClass(documentClass: string | null | undefined): boolean {
  return ["ccnuthesis", "thuthesis", "shtthesis"].includes((documentClass ?? "").toLowerCase());
}

function biblatexStyle(documentClass: string): string {
  return documentClass.toLowerCase() === "thuthesis" ? "thuthesis-numeric" : "numeric";
}

function renderTemplateMetadataSetup(metadata: Extract<DocumentBlock, { kind: "paper_metadata" }>, documentClass: string, usesBiblatex: boolean): string[] {
  const title = escapeLatex(metadata.title);
  const templateAuthor = metadata.authors.map(escapeLatex).join("、");
  switch (documentClass.toLowerCase()) {
    case "thuthesis":
      return [`\\thusetup{title = {${title}}, author = {${templateAuthor}}}`];
    case "shtthesis":
      return [`\\shtsetup{title = {${title}}, author = {${templateAuthor}}${usesBiblatex ? ", bib-resource = {references.bib}" : ""}}`];
    case "ccnuthesis":
      return [`\\ccnusetup{info = {title = {${title}}, author = {${templateAuthor}}}, style = {bib-resource = {references.bib}}}`];
    default:
      return [];
  }
}

function needsChapterAbstract(documentClass: string | null | undefined): boolean {
  return ["book", "ctexbook", "ctexrep", "cquthesis", "buctthesis", "ctexreport", "report", "scrbook", "scrreprt", "ucasthesis", "tongjithesis"].includes((documentClass ?? "").toLowerCase());
}

function renderAbstractBlock(block: Extract<DocumentBlock, { kind: "abstract" }>, documentClass: string | null | undefined): string {
  const content = renderInline(block.children);
  const normalized = (documentClass ?? "").toLowerCase();
  if (normalized === "seuthesiy") {
    const environment = block.language === "en" ? "englishabstract" : "abstract";
    const keywords = block.language === "en" ? "Keywords" : "关键词";
    return `\\begin{${environment}}{${keywords}}\n${content}\n\\end{${environment}}`;
  }
  if (normalized === "shuthesis") return `\\begin{${block.language === "en" ? "eabstract" : "cabstract"}}\n${content}\n\\end{${block.language === "en" ? "eabstract" : "cabstract"}}`;
  return needsChapterAbstract(documentClass)
    ? `\\chapter*{${block.language === "en" ? "Abstract" : "摘要"}}\n${content}`
    : `\\begin{abstract}\n${content}\n\\end{abstract}`;
}

function sectionCommand(level: number): string {
  return ["section", "subsection", "subsubsection", "paragraph", "subparagraph", "subparagraph"][level - 1] ?? "section";
}

function renderInline(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    switch (node.kind) {
      case "text": return escapeLatex(node.text);
      case "bold": return `\\textbf{${renderInline(node.children as InlineNode[])}}`;
      case "italic": return `\\textit{${renderInline(node.children as InlineNode[])}}`;
      case "superscript": return `\\textsuperscript{${renderInline(node.children as InlineNode[])}}`;
      case "subscript": return `\\textsubscript{${renderInline(node.children as InlineNode[])}}`;
      case "inline_math": return `$${node.latex}$`;
      case "citation": return `\\cite{${escapeLatex(node.referenceId)}}`;
      case "cross_reference": return `\\ref{${escapeLatex(node.targetId)}}`;
      case "footnote": return `\\footnote{${renderInline(node.children as InlineNode[])}}`;
    }
  }).join("");
}

function renderTable(block: Extract<DocumentBlock, { kind: "table" }>): string {
  const columns = "l".repeat(block.columns.length);
  const header = block.columns.map(escapeLatex).join(" & ");
  const rows = block.rows.map((row) => `${row.map(escapeLatex).join(" & ")} \\\\`).join("\n");
  return `\\begin{table}[htbp]\n\\centering\n\\begin{tabular}{${columns}}\n\\toprule\n${header} \\\\\n\\midrule\n${rows}\n\\bottomrule\n\\end{tabular}\n${block.caption ? `\\caption{${escapeLatex(block.caption)}}` : ""}\n\\end{table}`;
}

export function escapeLatex(value: string): string {
  return value.replace(/[\\{}%#$&_~^]/g, (character) => ({
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "%": "\\%",
    "#": "\\#",
    $: "\\$",
    "&": "\\&",
    "_": "\\_",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  })[character] ?? character);
}
