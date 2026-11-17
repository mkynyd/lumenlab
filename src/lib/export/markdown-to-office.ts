import { markdownNodeText, parseMarkdown } from "@/lib/export/markdown-ast";

export async function markdownToWorkbook(content: string) {
  const { utils, write } = await import("xlsx");
  const book = utils.book_new();
  let heading = "数据";
  for (const node of parseMarkdown(content).children) {
    if (node.type === "heading") heading = markdownNodeText(node).trim();
    if (node.type !== "table") continue;
    if (book.SheetNames.length >= 32) throw new Error("工作簿最多支持 32 个工作表");
    const rows = node.children.map((row, index) => row.children.map((cell) => {
      const value = markdownNodeText(cell).trim();
      // Preserve IDs with leading zeros and never interpret untrusted formula text.
      return index > 0 && value.replace(/[.\-]/g, "").length <= 15 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
        ? Number(value) : value;
    }));
    if (rows.length < 2 || rows[0].every((value) => !value)) {
      throw new Error("每张工作表需要表头和数据");
    }
    const sheet = utils.aoa_to_sheet(rows);
    sheet["!cols"] = rows.reduce<Array<{ wch: number }>>((widths, row) => {
      row.forEach((value, index) => {
        const visualLength = String(value).replace(/[^\x00-\x7f]/g, "xx").length;
        widths[index] = { wch: Math.min(60, Math.max(widths[index]?.wch ?? 12, visualLength + 3)) };
      });
      return widths;
    }, []);
    sheet["!autofilter"] = { ref: sheet["!ref"]! };
    const title = heading.replace(/[\\/?*\[\]:]/g, " ").replace(/^'+|'+$/g, "").trim() || "数据";
    let name = title.slice(0, 31);
    let suffix = 2;
    while (book.SheetNames.some((value) => value.toLowerCase() === name.toLowerCase())) {
      const ending = ` ${suffix++}`;
      name = `${title.slice(0, 31 - ending.length)}${ending}`;
    }
    utils.book_append_sheet(book, sheet, name);
  }
  if (!book.SheetNames.length) throw new Error("Excel 内容需要包含 Markdown 数据表");
  return Buffer.from(write(book, { type: "buffer", bookType: "xlsx", compression: true }));
}

function wrapText(value: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  let columns = 0;
  for (const char of value) {
    const next = char.codePointAt(0)! > 127 ? 2 : 1;
    if (char === "\n" || columns + next > width) {
      lines.push(line.trimEnd());
      line = "";
      columns = 0;
    }
    if (char !== "\n") {
      line += char;
      columns += next;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

export async function markdownToSlides(content: string, title: string) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.title = title;
  deck.theme = { headFontFace: "Microsoft YaHei", bodyFontFace: "Microsoft YaHei" };
  const sections: Array<{ title: string; lines: string[] }> = [];
  let section = { title, lines: [] as string[] };
  for (const node of parseMarkdown(content).children) {
    if (node.type === "heading" && node.depth <= 2) {
      if (section.lines.length) sections.push(section);
      section = { title: markdownNodeText(node).trim() || title, lines: [] };
      continue;
    }
    if (node.type === "table") throw new Error("演示文稿请把表格写成关键数据和简短要点");
    if (node.type === "list") {
      node.children.forEach((item, index) => {
        const marker = node.ordered ? `${(node.start ?? 1) + index}.` : "•";
        section.lines.push(...wrapText(`${marker} ${markdownNodeText(item)}`, 66));
      });
    } else {
      const body = markdownNodeText(node).trim();
      if (body) section.lines.push(...wrapText(body, 66));
    }
  }
  if (section.lines.length) sections.push(section);
  if (!sections.length) throw new Error("演示文稿需要可编辑的正文");
  let number = 0;
  for (const { title: heading, lines } of sections) {
    for (let offset = 0; offset < lines.length; offset += 8) {
      if (++number > 48) throw new Error("演示文稿超过 48 页，请精简或拆分");
      const slide = deck.addSlide();
      slide.background = { color: "F5F8FC" };
      slide.addText(wrapText(offset ? `${heading}（续）` : heading, 58).join("\n"), {
        x: 0.85, y: 0.65, w: 11.54, h: 1.3, fontSize: 28, bold: true,
        color: "132943", margin: 0, valign: "middle", fit: "shrink",
      });
      slide.addShape(deck.ShapeType.rect, {
        x: 0.85, y: 2.1, w: 1.05, h: 0.045, line: { transparency: 100 }, fill: { color: "2162A8" },
      });
      slide.addText(lines.slice(offset, offset + 8).join("\n"), {
        x: 0.88, y: 2.45, w: 11.5, h: 3.95, fontSize: 19, color: "223852",
        valign: "top", margin: 0, breakLine: false, lineSpacingMultiple: 1.14, fit: "shrink",
      });
      slide.addText(String(number).padStart(2, "0"), {
        x: 11.62, y: 6.74, w: 0.8, h: 0.35, align: "right", margin: 0, color: "455D78", fontSize: 11,
      });
    }
  }
  return Buffer.from(await deck.write({ outputType: "nodebuffer", compression: true }) as Buffer);
}
