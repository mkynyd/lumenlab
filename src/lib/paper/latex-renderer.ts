import type { AcademicDocument, DocumentBlock, InlineNode } from "./document-schema";
import type { AcademicTemplateManifest } from "./template-registry";
import { resolveTemplateClassOptions, type TemplateSourceFile } from "./template-snapshot";

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
  nodeMap: Record<string, { line: number; generatedLine: number; kind: string }>;
}

export function renderAcademicDocumentToLatex(document: AcademicDocument, options: { manifest?: AcademicTemplateManifest; references?: LatexReference[]; assetPaths?: Record<string, string>; templateFiles?: TemplateSourceFile[] } = {}): LatexRenderResult {
  const nodeMap: Record<string, { line: number; generatedLine: number; kind: string }> = {};
  const manifest = options.manifest;
  const templateFiles = options.templateFiles ?? [];
  const documentClass = /^[A-Za-z][A-Za-z0-9_-]*$/.test(manifest?.documentClass ?? "") ? manifest!.documentClass! : "ctexart";
  const classOptions = resolveTemplateClassOptions(manifest ?? { degreeType: null }, documentClass);
  const metadata = document.blocks.find((block): block is Extract<DocumentBlock, { kind: "paper_metadata" }> => block.kind === "paper_metadata");
  const usesBiber = /biber|biblatex/i.test(manifest?.bibliography ?? "");
  const sourceUsesBiblatex = templateFiles
    .filter((file) => /\.(?:cls|sty)$/i.test(file.path) || isLikelyTemplateEntrySource(file, manifest))
    .some((file) => /\\(?:RequirePackage|usepackage)\s*(?:\[[^\]]*\])?\s*\{\s*biblatex\s*\}/i.test(stripLatexComments(file.buffer?.toString("utf8") ?? "")));
  const usesTemplateBiblatex = usesBiber || (sourceUsesBiblatex && !/bibtex/i.test(manifest?.bibliography ?? "")) || isBiblatexTemplateClass(documentClass);
  const lines = [
    ...renderTemplatePreClassOptions(documentClass, templateFiles),
    `\\documentclass${classOptions.length > 0 ? `[${classOptions.join(",")}]` : ""}{${documentClass}}`,
    ...renderTemplatePreamble(templateFiles, manifest),
    "\\usepackage{amsmath,graphicx,booktabs,hyperref}",
    ...(usesBiber && !sourceUsesBiblatex && (!isBiblatexTemplateClass(documentClass) || templateFiles.length === 0) ? [`\\usepackage[backend=biber,style=${biblatexStyle(documentClass)}]{biblatex}`] : []),
    ...(usesTemplateBiblatex && !isBiblatexTemplateClass(documentClass) ? ["\\addbibresource{references.bib}"] : []),
    ...(metadata ? renderTemplateMetadataSetup(metadata, documentClass, usesTemplateBiblatex, templateFiles) : []),
    "\\begin{document}",
  ];
  const generated: string[] = [];
  for (const block of document.blocks) {
    const generatedLine = generated.length === 0 ? 1 : generated.join("\n\n").split("\n").length + 1;
    const startLine = lines.length + generatedLine;
    const blockText = renderBlock(block, options.assetPaths, manifest, usesTemplateBiblatex, templateFiles);
    generated.push(blockText);
    const id = "id" in block && typeof block.id === "string" ? block.id : block.kind;
    nodeMap[id] = { line: startLine, generatedLine, kind: block.kind };
  }
  lines.push("\\input{generated-content.tex}", "\\end{document}");
  return {
    mainTex: `${lines.join("\n")}\n`,
    generatedContentTex: `${generated.join("\n\n")}\n`,
    referencesBib: (options.references ?? []).map(toBibtex).join("\n\n") + (options.references?.length ? "\n" : ""),
    nodeMap,
  };
}

function renderTemplatePreClassOptions(documentClass: string, files: TemplateSourceFile[]): string[] {
  if (documentClass.toLowerCase() !== "nuaathesis") return [];
  const source = files.map((file) => file.buffer?.toString("utf8") ?? "").join("\n");
  if (!/\\DeclareStringOption\s*\{fontset\}/i.test(source)) return [];
  return ["\\PassOptionsToClass{fontset=fandol}{ctexbook}", "\\PassOptionsToPackage{fontset=fandol}{ctex}"];
}

function stripLatexComments(source: string): string {
  return source.replace(/(^|[^\\])%[^\n]*/g, "$1");
}

function isLikelyTemplateEntrySource(file: TemplateSourceFile, manifest?: AcademicTemplateManifest): boolean {
  if (!file.buffer || !/\.tex$/i.test(file.path)) return false;
  const source = stripLatexComments(file.buffer.toString("utf8"));
  return file.path === manifest?.entryFile || (!file.path.includes("/") && /\\documentclass\b/i.test(source));
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

function renderBlock(block: DocumentBlock, assetPaths?: Record<string, string>, manifest?: AcademicTemplateManifest, usesTemplateBiblatex = false, templateFiles: TemplateSourceFile[] = []): string {
  switch (block.kind) {
    case "paper_metadata":
      if ((manifest?.documentClass ?? "").toLowerCase() === "hhuthesis") return "";
      return hasCustomMetadataAdapter(templateFiles)
        ? "\\maketitle"
        : (manifest?.documentClass ?? "").toLowerCase() === "ccnuthesis"
        ? "\\frontmatter"
        : isSpecialMetadataClass(manifest?.documentClass)
          ? "\\maketitle"
          : `\\title{${escapeLatex(block.title)}}\n\\author{${block.authors.map(escapeLatex).join(templateFiles.length > 0 ? "、" : " \\and ")}}\n\\maketitle`;
    case "abstract":
      return renderAbstractBlock(block, manifest?.documentClass, templateFiles);
    case "keywords":
      return renderKeywordsBlock(block, templateFiles);
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
      return usesTemplateBiblatex
        ? "\\printbibliography"
        : `\\bibliography{references}${hasTemplateBibliographyStyle(templateFiles) ? "" : "\n\\bibliographystyle{plain}"}`;
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
  return ["ccnuthesis", "thuthesis", "shtthesis"].includes((documentClass ?? "").toLowerCase());
}

function isSpecialMetadataClass(documentClass: string | null | undefined): boolean {
  return ["ccnuthesis", "seuthesiy", "thuthesis", "shtthesis"].includes((documentClass ?? "").toLowerCase());
}

function biblatexStyle(documentClass: string): string {
  return documentClass.toLowerCase() === "thuthesis" ? "thuthesis-numeric" : "numeric";
}

function renderTemplateMetadataSetup(metadata: Extract<DocumentBlock, { kind: "paper_metadata" }>, documentClass: string, usesBiblatex: boolean, templateFiles: TemplateSourceFile[]): string[] {
  const title = escapeLatex(metadata.title);
  const templateAuthor = metadata.authors.map(escapeLatex).join("、");
  const degree = escapeLatex(metadata.degreeType ?? "硕士");
  const englishDegree = degree.includes("博士") ? "Doctor" : degree.includes("本科") || degree.includes("学士") ? "Bachelor" : "Master";
  const institution = escapeLatex(metadata.institution ?? "");
  switch (documentClass.toLowerCase()) {
    case "thuthesis":
      return [`\\thusetup{title = {${title}}, author = {${templateAuthor}}}`];
    case "shtthesis":
      return [`\\shtsetup{title = {${title}}, author = {${templateAuthor}}${usesBiblatex ? ", bib-resource = {references.bib}" : ""}}`];
    case "seuthesiy":
      return [`\\title{${title}}{${title}}{}{}{${title}}{${title}}`, `\\author{${templateAuthor}}{${templateAuthor}}`];
    case "scuthesis": {
      const lines: string[] = [];
      if (hasTemplateCommand(templateFiles, "CoverTitle")) lines.push(`\\CoverTitle{${title}}`);
      if (hasTemplateCommand(templateFiles, "ENGtitle")) lines.push(`\\ENGtitle{${title}}`);
      if (hasTemplateCommand(templateFiles, "ENGauthor")) lines.push(`\\ENGauthor{${templateAuthor}}`);
      if (hasTemplateCommand(templateFiles, "accomplishdate")) lines.push("\\accomplishdate{2026}");
      if (hasTemplateCommand(templateFiles, "school") && institution) lines.push(`\\school{${institution}}`);
      if (hasTemplateCommand(templateFiles, "supervisor")) lines.push("\\supervisor{Research Supervisor}");
      if (hasTemplateCommand(templateFiles, "major")) lines.push("\\major{Computer Science}");
      if (hasTemplateCommand(templateFiles, "direction")) lines.push("\\direction{Deep Research}");
      if (hasTemplateCommand(templateFiles, "defensedate")) lines.push("\\defensedate{2026}");
      if (hasTemplateCommand(templateFiles, "keywords")) lines.push("\\keywords{深度研究、论文排版、证据}");
      if (hasTemplateCommand(templateFiles, "ENGkeywords")) lines.push("\\ENGkeywords{research, paper, evidence}");
      return lines;
    }
    case "ccnuthesis":
      return [`\\ccnusetup{info = {title = {${title}}, author = {${templateAuthor}}}, style = {bib-resource = {references.bib}}}`];
    default: {
      const lines: string[] = [];
      if (hasTemplateCommand(templateFiles, "cumtsetup")) {
        lines.push(`\\cumtsetup{title = {${title}}, author = {${templateAuthor}}, thesis-type = {${degree}学位论文}, affiliation = {${institution}}, year = {${escapeLatex(metadata.date ?? "2026")}}}`);
      }
      if (hasTemplateCommand(templateFiles, "nuaaset")) {
        lines.push(`\\nuaaset{title = {${title}}, author = {${templateAuthor}}}`);
        lines.push(`\\title{${title}}`, `\\author{${templateAuthor}}`);
      }
      if (hasTemplateCommand(templateFiles, "Title")) lines.push(`\\Title{${title}}{${title}}`);
      if (hasTemplateCommand(templateFiles, "Author")) lines.push(`\\Author{${templateAuthor}}{${templateAuthor}}`);
      if (hasTemplateCommand(templateFiles, "thesisTitle")) lines.push(`\\thesisTitle{${title}}{${title}}`);
      if (hasTemplateCommand(templateFiles, "zhtitle")) lines.push(`\\zhtitle{${title}}`);
      if (hasTemplateCommand(templateFiles, "entitle")) lines.push(`\\entitle{${title}}`);
      if (hasTemplateCommand(templateFiles, "englishtitle")) lines.push(`\\englishtitle{${title}}`);
      if (hasTemplateCommand(templateFiles, "englishauthor")) lines.push(`\\englishauthor{${templateAuthor}}`);
      if (hasTemplateCommand(templateFiles, "institute") && institution) lines.push(`\\institute{${institution}}`);
      if (hasTemplateCommand(templateFiles, "degree")) lines.push(`\\degree{${degree}}`);
      if (hasTemplateCommand(templateFiles, "englishdegree")) lines.push(`\\englishdegree{${englishDegree}}`);
      if (hasTemplateCommand(templateFiles, "thesiskeywords")) lines.push("\\thesiskeywords{深度研究、论文排版、证据}");
      if (hasTemplateCommand(templateFiles, "title") && !lines.some((line) => /\\(?:Title|thesisTitle)\b/.test(line))) lines.push(`\\title{${title}}`);
      if (hasTemplateCommand(templateFiles, "author") && !lines.some((line) => /\\Author\b/.test(line))) lines.push(`\\author{${templateAuthor}}`);
      if (usesBiblatex && hasTemplateToken(templateFiles, "addbibresource")) lines.push("\\addbibresource{references.bib}");
      return lines;
    }
  }
}

function needsChapterAbstract(documentClass: string | null | undefined, templateFiles: TemplateSourceFile[]): boolean {
  const normalized = (documentClass ?? "").toLowerCase();
  if (["book", "ctexbook", "ctexrep", "cquthesis", "buctthesis", "ctexreport", "report", "scrbook", "scrreprt", "ucasthesis", "tongjithesis"].includes(normalized)) return true;
  return templateFiles
    .filter((file) => /\.cls$/i.test(file.path) && isPrimaryTemplateDefinitionFile(file))
    .some((file) => /\\LoadClass(?:WithOptions)?\s*(?:\[[^\]]*\])?\s*\{\s*(?:book|report|ctexbook|ctexrep|scrbook|scrreprt)\s*\}/i.test(stripLatexComments(file.buffer?.toString("utf8") ?? "")));
}

function renderAbstractBlock(block: Extract<DocumentBlock, { kind: "abstract" }>, documentClass: string | null | undefined, templateFiles: TemplateSourceFile[]): string {
  const content = renderInline(block.children);
  const normalized = (documentClass ?? "").toLowerCase();
  if (normalized === "seuthesiy") {
    const environment = block.language === "en" ? "englishabstract" : "abstract";
    const keywords = block.language === "en" ? "Keywords" : "关键词";
    return `\\begin{${environment}}{${keywords}}\n${content}\n\\end{${environment}}`;
  }
  if (normalized === "shuthesis") return `\\begin{${block.language === "en" ? "eabstract" : "cabstract"}}\n${content}\n\\end{${block.language === "en" ? "eabstract" : "cabstract"}}`;
  const environment = block.language === "en"
    ? hasTemplateEnvironment(templateFiles, "abstractEn") ? "abstractEn" : hasTemplateEnvironment(templateFiles, "enabstract") ? "enabstract" : null
    : hasTemplateEnvironment(templateFiles, "abstract") ? "abstract" : null;
  return needsChapterAbstract(documentClass, templateFiles) && !environment
    ? `\\chapter*{${block.language === "en" ? "Abstract" : "摘要"}}\n${content}`
    : `\\begin{${environment ?? "abstract"}}\n${content}\n\\end{${environment ?? "abstract"}}`;
}

function renderKeywordsBlock(block: Extract<DocumentBlock, { kind: "keywords" }>, templateFiles: TemplateSourceFile[]): string {
  const keywords = block.keywords.map(escapeLatex).join("；");
  if (hasTemplateCommand(templateFiles, "keywords")) return `\\keywords{${keywords}}`;
  if (hasTemplateCommand(templateFiles, "thesiskeywords")) return `\\thesiskeywords{${keywords}}`;
  return `\\textbf{关键词：}${keywords}`;
}

function hasTemplateCommand(files: TemplateSourceFile[], command: string): boolean {
  if (!files.length) return false;
  const pattern = new RegExp(`\\\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|def)\\s*\\*?\\s*(?:\\\\?\\{)?\\\\${command}\\b`);
  return files.filter(isPrimaryTemplateDefinitionFile).some((file) => file.buffer?.toString("utf8").match(pattern));
}

function hasTemplateToken(files: TemplateSourceFile[], token: string): boolean {
  return files.filter(isPrimaryTemplateDefinitionFile).some((file) => (file.buffer?.toString("utf8") ?? "").includes(`\\${token}`));
}

function hasTemplateBibliographyStyle(files: TemplateSourceFile[]): boolean {
  return files
    .filter(isPrimaryTemplateDefinitionFile)
    .some((file) => /\\bibliographystyle\s*\{/i.test(stripLatexComments(file.buffer?.toString("utf8") ?? "")));
}

function hasTemplateEnvironment(files: TemplateSourceFile[], environment: string): boolean {
  const pattern = new RegExp(`\\\\(?:newenvironment|renewenvironment|NewDocumentEnvironment)\\s*(?:\\*\\s*)?\\{${environment}\\}`);
  return files.filter(isPrimaryTemplateDefinitionFile).some((file) => pattern.test(file.buffer?.toString("utf8") ?? ""));
}

function isPrimaryTemplateDefinitionFile(file: TemplateSourceFile): boolean {
  if (/\.(?:cls|sty)$/i.test(file.path)) {
    return !/(?:^|\/)(?:reference|references|dependency|dependencies|vendor|base|ctex)(?:\/|$)/i.test(file.path);
  }
  return /(?:^|\/)(?:main|template|thesis)\.tex$/i.test(file.path);
}

function hasCustomMetadataAdapter(files: TemplateSourceFile[]): boolean {
  return ["cumtsetup", "nuaaset", "Title", "Author", "thesisTitle", "zhtitle", "chinesetitle", "englishtitle"].some((command) => hasTemplateCommand(files, command));
}

function renderTemplatePreamble(files: TemplateSourceFile[], manifest?: AcademicTemplateManifest): string[] {
  const entry = files.find((file) => file.path === manifest?.entryFile)
    ?? files.filter((file) => /\.tex$/i.test(file.path) && !/\.dtx$/i.test(file.path) && file.buffer).sort((left, right) => {
      const score = (file: TemplateSourceFile) => {
        const source = file.buffer?.toString("utf8") ?? "";
        const name = file.path.split("/").at(-1) ?? file.path;
        return (source.includes("\\documentclass") ? -100 : 0)
          + (/^(?:main|thesis|template|paper)/i.test(name) ? -20 : 0)
          + (file.path.includes("/") ? 10 : 0)
          + (/(?:readme|example|sample|test)/i.test(file.path) ? 20 : 0);
      };
      return score(left) - score(right) || left.path.localeCompare(right.path);
    })[0];
  if (!entry?.buffer) return [];
  const lines: string[] = [];
  const seen = new Set<string>();
  const source = stripLatexComments(entry.buffer.toString("utf8"));
  const pattern = /\\usepackage(?:\[([^\]]*)\])?\s*\{([^}]+)\}/gi;
  for (const match of source.matchAll(pattern)) {
    const options = (match[1] ?? "").trim();
    for (const rawName of (match[2] ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
      const name = rawName.replace(/\.sty$/i, "");
      const standardPackage = /^(?:amsmath|graphicx|booktabs|hyperref)$/i.test(name);
      if (!/^[A-Za-z0-9_.\/-]+$/.test(name) || name.includes("..") || seen.has(name) || standardPackage) continue;
      seen.add(name);
      const normalizedOptions = /^ctex$/i.test(name) && /(?:^|,)\s*fontset\s*=\s*none\s*(?:,|$)/i.test(options)
        ? options.replace(/fontset\s*=\s*none/gi, "fontset=fandol")
        : options;
      lines.push(`\\usepackage${normalizedOptions ? `[${normalizedOptions}]` : ""}{${name}}`);
    }
  }
  return lines;
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
