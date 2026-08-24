import { createHash } from "node:crypto";
import type { DocumentBlock, InlineNode } from "./document-schema";

export interface ParsedLatexSource {
  title?: string;
  authors: string[];
  date?: string;
  blocks: DocumentBlock[];
  warnings: string[];
  lowConfidenceBlocks: Array<{ index: number; reason: string }>;
}

function idFor(prefix: string, value: string, index: number) {
  const hash = createHash("sha1").update(prefix + ":" + index + ":" + value).digest("hex").slice(0, 12);
  return prefix + "-" + hash;
}

function isEscaped(value: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function readBalanced(value: string, openIndex: number, open = "{", close = "}") {
  if (value[openIndex] !== open) return null;
  let depth = 0;
  for (let cursor = openIndex; cursor < value.length; cursor += 1) {
    if (value[cursor] === open && !isEscaped(value, cursor)) depth += 1;
    if (value[cursor] === close && !isEscaped(value, cursor)) {
      depth -= 1;
      if (depth === 0) return { content: value.slice(openIndex + 1, cursor), end: cursor + 1 };
    }
  }
  return null;
}

function commandNameAt(value: string, index: number) {
  const match = /^\\([A-Za-z@]+|.)/.exec(value.slice(index));
  return match ? { name: match[1], end: index + match[0].length } : null;
}

function commandArgument(value: string, commandIndex: number) {
  const command = commandNameAt(value, commandIndex);
  if (!command) return null;
  let cursor = command.end;
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  if (value[cursor] !== "{") return null;
  const argument = readBalanced(value, cursor);
  return argument ? { command, argument } : null;
}

function findCommandArgument(value: string, name: string) {
  const command = new RegExp("\\\\" + name + "\\s*\\{", "i").exec(value);
  if (!command) return null;
  return commandArgument(value, command.index);
}

function stripLatexComments(value: string) {
  return value.split("\n").map((line) => {
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === "%" && !isEscaped(line, index)) return line.slice(0, index);
    }
    return line;
  }).join("\n");
}

function stripLatexMarkup(value: string) {
  return stripLatexComments(value)
    .replace(/\\(?:label|index|glossary)\s*\{[^{}]*\}/g, "")
    .replace(/\\(?:textbf|textit|texttt|textrm|textsf|emph|underline|url|href)\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:left|right|,|;|:|!|quad|qquad|enspace|hspace|vspace)\b\s*(?:\{[^{}]*\})?/g, " ")
    .replace(/\\([%#$&_{}])/g, "$1")
    .replace(/\\[A-Za-z@]+\*?(?:\s*\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plainText(value: string) {
  return stripLatexMarkup(value).replace(/\s+/g, " ").trim();
}

function languageFor(value: string): "zh" | "en" {
  return /[\u3400-\u9fff]/.test(value) ? "zh" : "en";
}

function pushInlineText(nodes: InlineNode[], value: string) {
  if (!value) return;
  const previous = nodes.at(-1);
  if (previous?.kind === "text") previous.text += value;
  else nodes.push({ kind: "text", text: value });
}

function parseInlineLatex(value: string, seed: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let cursor = 0;
  let plain = "";
  const flushPlain = () => {
    if (plain) pushInlineText(nodes, stripLatexMarkup(plain));
    plain = "";
  };
  while (cursor < value.length) {
    if (value[cursor] === "$" && !isEscaped(value, cursor)) {
      const double = value[cursor + 1] === "$";
      const close = value.indexOf(double ? "$$" : "$", cursor + (double ? 2 : 1));
      if (close >= 0) {
        flushPlain();
        const latex = value.slice(cursor + (double ? 2 : 1), close).trim();
        if (latex) nodes.push({ kind: "inline_math", latex });
        cursor = close + (double ? 2 : 1);
        continue;
      }
    }
    if (value.startsWith("\\(", cursor)) {
      const close = value.indexOf("\\)", cursor + 2);
      if (close >= 0) {
        flushPlain();
        const latex = value.slice(cursor + 2, close).trim();
        if (latex) nodes.push({ kind: "inline_math", latex });
        cursor = close + 2;
        continue;
      }
    }
    if (value[cursor] !== "\\") {
      plain += value[cursor];
      cursor += 1;
      continue;
    }
    const command = commandNameAt(value, cursor);
    if (!command) {
      plain += value[cursor];
      cursor += 1;
      continue;
    }
    const name = command.name.toLowerCase();
    const argument = commandArgument(value, cursor);
    const argumentValue = argument?.argument.content ?? "";
    if (["cite", "citep", "citet", "citeauthor", "citeyear"].includes(name) && argument) {
      flushPlain();
      for (const referenceId of argumentValue.split(",").map((item) => item.trim()).filter(Boolean)) nodes.push({ kind: "citation", referenceId });
      cursor = argument.argument.end;
      continue;
    }
    if (["ref", "eqref", "autoref", "pageref"].includes(name) && argument) {
      flushPlain();
      if (argumentValue.trim()) nodes.push({ kind: "cross_reference", targetId: argumentValue.trim() });
      cursor = argument.argument.end;
      continue;
    }
    if (name === "footnote" && argument) {
      flushPlain();
      const children = parseInlineLatex(argumentValue, seed + "-footnote");
      nodes.push({ kind: "footnote", id: idFor("footnote", argumentValue, nodes.length), children: children.length ? children : [{ kind: "text", text: "脚注内容待确认" }] } as InlineNode);
      cursor = argument.argument.end;
      continue;
    }
    const formatting: Record<string, "bold" | "italic" | "superscript" | "subscript"> = {
      textbf: "bold",
      bfseries: "bold",
      textit: "italic",
      emph: "italic",
      textsuperscript: "superscript",
      textsubscript: "subscript",
    };
    const format = formatting[name];
    if (format && argument) {
      flushPlain();
      const children = parseInlineLatex(argumentValue, seed + "-" + name);
      nodes.push({ kind: format, children: children.length ? children : [{ kind: "text", text: "" }] } as InlineNode);
      cursor = argument.argument.end;
      continue;
    }
    if (["texttt", "textrm", "textsf", "underline", "url", "href"].includes(name) && argument) {
      plain += argumentValue;
      cursor = argument.argument.end;
      continue;
    }
    if (name === "label" || name === "index" || name === "glossary") {
      cursor = argument?.argument.end ?? command.end;
      continue;
    }
    if (["noindent", "newline", "linebreak", "par", "smallskip", "medskip", "bigskip", "enspace", "quad", "qquad"].includes(name)) {
      plain += name === "par" ? "\n\n" : " ";
      cursor = command.end;
      continue;
    }
    if (["%", "$", "#", "&", "_", "{", "}"].includes(command.name)) {
      plain += command.name;
      cursor = command.end;
      continue;
    }
    plain += value.slice(cursor, command.end);
    cursor = command.end;
  }
  flushPlain();
  return nodes.filter((node) => node.kind !== "text" || node.text.length > 0);
}

function splitTopLevel(value: string, separator: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    if (value[cursor] === "{" && !isEscaped(value, cursor)) depth += 1;
    if (value[cursor] === "}" && !isEscaped(value, cursor)) depth = Math.max(0, depth - 1);
    if (depth === 0 && value.startsWith(separator, cursor) && !isEscaped(value, cursor)) {
      parts.push(value.slice(start, cursor));
      cursor += separator.length - 1;
      start = cursor + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function extractEnvironment(value: string, start: number, name: string) {
  const begin = new RegExp("^\\\\begin\\s*\\{" + name.replace("*", "\\\\*") + "\\}");
  const first = begin.exec(value.slice(start));
  if (!first) return null;
  const token = /\\(begin|end)\s*\{([^{}]+)\}/g;
  token.lastIndex = start + first[0].length;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = token.exec(value)) !== null) {
    if (match[2] !== name) continue;
    if (match[1] === "begin") depth += 1;
    else {
      depth -= 1;
      if (depth === 0) return { inner: value.slice(start + first[0].length, match.index), end: match.index + match[0].length };
    }
  }
  return null;
}

function tableBlockFromLatex(inner: string, index: number) {
  const tabularStart = /\\begin\s*\{tabular\*?\}/i.exec(inner);
  if (!tabularStart || /\\(?:multi(?:column|row))/i.test(inner)) return null;
  let cursor = tabularStart.index + tabularStart[0].length;
  while (/\s/.test(inner[cursor] ?? "")) cursor += 1;
  if (inner[cursor] === "[") {
    const optionEnd = inner.indexOf("]", cursor + 1);
    if (optionEnd < 0) return null;
    cursor = optionEnd + 1;
    while (/\s/.test(inner[cursor] ?? "")) cursor += 1;
  }
  const columnsArgument = readBalanced(inner, cursor);
  if (!columnsArgument) return null;
  const endMatch = /\\end\s*\{tabular\*?\}/ig;
  endMatch.lastIndex = columnsArgument.end;
  const end = endMatch.exec(inner);
  if (!end) return null;
  const rows = splitTopLevel(
    inner.slice(columnsArgument.end, end.index).replace(/\\(?:hline|toprule|midrule|bottomrule|cline(?:\[[^\]]*\])?)\b(?:\{[^}]*\})?/g, ""),
    "\\\\",
  ).map((row) => row.trim()).filter(Boolean).map((row) => splitTopLevel(row, "&").map((cell) => stripLatexMarkup(cell)));
  if (!rows.length || !rows[0].length) return null;
  const captionIndex = inner.search(/\\caption\s*\{/i);
  const labelIndex = inner.search(/\\label\s*\{/i);
  const caption = captionIndex >= 0 ? commandArgument(inner, captionIndex)?.argument.content : undefined;
  const label = labelIndex >= 0 ? commandArgument(inner, labelIndex)?.argument.content : undefined;
  const columns = rows[0].map((cell, column) => cell || "列 " + (column + 1));
  const dataRows = rows.slice(1).length ? rows.slice(1) : [columns.map(() => "")];
  return {
    kind: "table" as const,
    id: idFor("table", inner, index),
    columns,
    rows: dataRows,
    ...(caption ? { caption } : {}),
    ...(label ? { label } : {}),
  };
}

function environmentBlock(name: string, inner: string, index: number): { block: DocumentBlock | null; reason?: string } {
  const normalized = name.toLowerCase();
  if (normalized === "abstract") {
    const children = parseInlineLatex(inner.trim(), "abstract-" + index);
    return children.length ? { block: { kind: "abstract", language: languageFor(inner), children } } : { block: null };
  }
  if (normalized === "keywords" || normalized === "ckeywords" || normalized === "ekeywords") {
    const keywords = stripLatexMarkup(inner).split(/[,，;；]/).map((item) => item.trim()).filter(Boolean);
    return keywords.length ? { block: { kind: "keywords", language: normalized.startsWith("e") ? "en" : "zh", keywords } } : { block: null, reason: "关键词环境为空" };
  }
  if (normalized === "equation" || normalized === "equation*" || normalized === "align" || normalized === "align*") {
    const labelIndex = inner.search(/\\label\s*\{/i);
    const label = labelIndex >= 0 ? commandArgument(inner, labelIndex)?.argument.content.trim() : undefined;
    const latex = inner.replace(/\\label\s*\{[^{}]*\}/g, "").trim();
    return latex ? { block: { kind: "equation", id: idFor("equation", latex, index), latex, ...(label ? { label } : {}) } } : { block: null, reason: "公式环境为空" };
  }
  if (normalized === "table") {
    const block = tableBlockFromLatex(inner, index);
    return block ? { block } : { block: null, reason: "表格包含无法确定性转换的 tabular 结构" };
  }
  if (normalized === "itemize" || normalized === "enumerate") {
    const items: InlineNode[][] = [];
    const itemPattern = /\\item(?:\s*\[[^\]]*\])?\s*/g;
    const matches = [...inner.matchAll(itemPattern)];
    for (let itemIndex = 0; itemIndex < matches.length; itemIndex += 1) {
      const start = (matches[itemIndex].index ?? 0) + matches[itemIndex][0].length;
      const end = itemIndex + 1 < matches.length ? matches[itemIndex + 1].index ?? inner.length : inner.length;
      const item = parseInlineLatex(inner.slice(start, end).trim(), "list-" + index + "-" + itemIndex);
      if (item.length) items.push(item);
    }
    return items.length ? { block: { kind: "list", id: idFor("list", inner, index), ordered: normalized === "enumerate", items } } : { block: null, reason: "列表环境缺少可解析的 item" };
  }
  if (normalized === "quote" || normalized === "quotation" || normalized === "verse") {
    const children = parseInlineLatex(inner.trim(), "quote-" + index);
    return children.length ? { block: { kind: "quote", id: idFor("quote", inner, index), children } } : { block: null, reason: "引文环境为空" };
  }
  if (normalized === "acknowledgement" || normalized === "acknowledgements") return { block: { kind: "acknowledgement", children: parseInlineLatex(inner.trim(), "acknowledgement-" + index) } };
  if (normalized === "figure" || normalized === "figure*") return { block: null, reason: "单独 LaTeX 文件没有随附图片二进制资源，Figure 环境已原样保留" };
  if (normalized === "thebibliography") return { block: null, reason: "参考文献条目尚未绑定到 Paper Reference，bibliography 环境已原样保留" };
  return { block: null, reason: "无法可靠转换自定义环境：" + name };
}

const knownInlineCommands = new Set([
  "cite", "citep", "citet", "citeauthor", "citeyear", "ref", "eqref", "autoref", "pageref", "footnote",
  "textbf", "bfseries", "textit", "emph", "textsuperscript", "textsubscript", "texttt", "textrm", "textsf",
  "underline", "url", "href", "label", "index", "glossary", "noindent", "newline", "linebreak", "par",
  "smallskip", "medskip", "bigskip", "enspace", "quad", "qquad", "latex", "tex",
]);

function hasUnknownMacro(value: string) {
  for (const match of value.matchAll(/\\([A-Za-z@]+)/g)) {
    if (!knownInlineCommands.has(match[1].toLowerCase())) return true;
  }
  return false;
}

export function parseLatexSource(source: string): ParsedLatexSource {
  const content = stripLatexComments(source.replace(/\r\n?/g, "\n"));
  const title = plainText(findCommandArgument(content, "title")?.argument.content ?? "") || undefined;
  const authorRaw = findCommandArgument(content, "author")?.argument.content ?? "";
  const authors = authorRaw.split(/\\and|\\\\|\n|；|;/).map((author) => plainText(author)).filter(Boolean);
  const date = plainText(findCommandArgument(content, "date")?.argument.content ?? "") || undefined;
  const documentStart = /\\begin\s*\{document\}/i.exec(content);
  const documentEnd = /\\end\s*\{document\}/i.exec(content);
  const body = documentStart ? content.slice(documentStart.index + documentStart[0].length, documentEnd?.index ?? content.length) : content;
  const blocks: DocumentBlock[] = [];
  const warnings: string[] = [];
  const lowConfidenceBlocks: Array<{ index: number; reason: string }> = [];
  const addRaw = (raw: string, reason: string) => {
    const value = raw.trim();
    if (!value) return;
    blocks.push({ kind: "raw_latex", id: idFor("raw", value, blocks.length), latex: value });
    lowConfidenceBlocks.push({ index: blocks.length - 1, reason });
    warnings.push(reason);
  };
  const addParagraphs = (raw: string) => {
    const normalized = stripLatexComments(raw).trim();
    if (!normalized) return;
    for (const paragraph of normalized.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean)) {
      if (/^\\(?:frontmatter|mainmatter|backmatter|tableofcontents|listoffigures|listoftables|maketitle)\b/i.test(paragraph)) continue;
      if (hasUnknownMacro(paragraph)) {
        addRaw(paragraph, "包含无法可靠转换的自定义 LaTeX 宏，已原样保留");
        continue;
      }
      const children = parseInlineLatex(paragraph, "paragraph-" + blocks.length);
      if (children.length) blocks.push({ kind: "paragraph", id: idFor("paragraph", paragraph, blocks.length), children });
    }
  };
  const structural = /\\begin\s*\{([A-Za-z*]+)\}|\\end\s*\{([A-Za-z*]+)\}|\\(?:section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{|\\(?:keywords|ckeywords|ekeywords|maketitle|appendix|clearpage|newpage|bibliography|bibliographystyle|addbibresource|printbibliography)\b|\\\[|\$\$/gi;
  let cursor = 0;
  let token: RegExpExecArray | null;
  while ((token = structural.exec(body)) !== null) {
    addParagraphs(body.slice(cursor, token.index));
    const rawToken = token[0];
    if (token[1]) {
      const extracted = extractEnvironment(body, token.index, token[1]);
      if (!extracted) {
        addRaw(body.slice(token.index), "环境 " + token[1] + " 缺少结束标记，已原样保留");
        cursor = body.length;
        structural.lastIndex = cursor;
        continue;
      }
      const result = environmentBlock(token[1], extracted.inner, blocks.length);
      if (result.block) blocks.push(result.block);
      else addRaw(body.slice(token.index, extracted.end), result.reason ?? ("环境 " + token[1] + " 无法转换"));
      cursor = extracted.end;
      structural.lastIndex = cursor;
      continue;
    }
    if (token[2]) {
      addRaw(rawToken, "发现未配对的结束环境：" + token[2]);
      cursor = token.index + rawToken.length;
      structural.lastIndex = cursor;
      continue;
    }
    if (rawToken === "$$" || rawToken === "\\[") {
      const close = body.indexOf(rawToken === "$$" ? "$$" : "\\]", token.index + rawToken.length);
      if (close < 0) {
        addRaw(body.slice(token.index), "显示公式缺少结束标记，已原样保留");
        cursor = body.length;
      } else {
        const latex = body.slice(token.index + rawToken.length, close).trim();
        if (latex) blocks.push({ kind: "equation", id: idFor("equation", latex, blocks.length), latex });
        cursor = close + rawToken.length;
      }
      structural.lastIndex = cursor;
      continue;
    }
    const command = commandNameAt(body, token.index);
    if (!command) continue;
    const name = command.name.toLowerCase();
    if (["section", "subsection", "subsubsection", "paragraph", "subparagraph"].includes(name)) {
      const argument = commandArgument(body, token.index);
      if (!argument) {
        addRaw(body.slice(token.index), "标题命令 " + name + " 缺少参数，已原样保留");
        cursor = body.length;
        structural.lastIndex = cursor;
        continue;
      }
      const heading = plainText(argument.argument.content);
      let end = argument.argument.end;
      let label: string | undefined;
      const labelMatch = /^\s*\\label\s*\{/.exec(body.slice(end));
      if (labelMatch) {
        const openIndex = end + (labelMatch.index ?? 0) + labelMatch[0].length - 1;
        const labelArgument = readBalanced(body, openIndex);
        if (labelArgument) {
          label = labelArgument.content.trim();
          end = labelArgument.end;
        }
      }
      if (heading) blocks.push({ kind: "heading", id: label || idFor("heading", heading, blocks.length), level: name === "section" ? 1 : name === "subsection" ? 2 : name === "subsubsection" ? 3 : name === "paragraph" ? 4 : 5, children: parseInlineLatex(argument.argument.content, "heading-" + blocks.length) });
      cursor = end;
      structural.lastIndex = cursor;
      continue;
    }
    if (["keywords", "ckeywords", "ekeywords"].includes(name)) {
      const argument = commandArgument(body, token.index);
      const keywords = argument ? plainText(argument.argument.content).split(/[,，;；]/).map((item) => item.trim()).filter(Boolean) : [];
      if (keywords.length) blocks.push({ kind: "keywords", language: name.startsWith("e") ? "en" : "zh", keywords });
      else addRaw(body.slice(token.index, argument?.argument.end ?? token.index + rawToken.length), "关键词命令为空，已原样保留");
      cursor = argument?.argument.end ?? token.index + rawToken.length;
      structural.lastIndex = cursor;
      continue;
    }
    if (["bibliography", "bibliographystyle", "addbibresource", "printbibliography"].includes(name)) {
      const argument = commandArgument(body, token.index);
      const end = argument?.argument.end ?? token.index + rawToken.length;
      addRaw(body.slice(token.index, end), "参考文献命令需要在导入后绑定 Paper Reference，已原样保留");
      cursor = end;
      structural.lastIndex = cursor;
      continue;
    }
    if (["clearpage", "newpage"].includes(name)) {
      blocks.push({ kind: "page_break", id: idFor("page-break", name, blocks.length) });
      cursor = command.end;
      structural.lastIndex = cursor;
      continue;
    }
    cursor = command.end;
    structural.lastIndex = cursor;
  }
  addParagraphs(body.slice(cursor));
  return { title, authors, date, blocks, warnings: [...new Set(warnings)], lowConfidenceBlocks };
}
