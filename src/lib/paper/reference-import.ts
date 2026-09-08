export interface ParsedPaperReference {
  doi?: string;
  arxivId?: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  url?: string;
  rawMeta: Record<string, unknown>;
}

function cleanBibValue(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\\([{}])/g, "$1").replace(/\s+/g, " ").trim();
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const fieldPattern = /([a-z][a-z0-9_-]*)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)"|([^,\n]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(body)) !== null) {
    const key = match[1].toLowerCase();
    fields[key] = cleanBibValue(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return fields;
}

function parseYear(value: string | undefined): number | undefined {
  const year = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(year) && year > 0 ? year : undefined;
}

export function parseBibTeX(input: string): ParsedPaperReference[] {
  const references: ParsedPaperReference[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const at = input.indexOf("@", cursor);
    if (at < 0) break;
    const open = input.indexOf("{", at);
    if (open < 0) break;
    let depth = 0;
    let close = -1;
    for (let index = open; index < input.length; index += 1) {
      if (input[index] === "{") depth += 1;
      if (input[index] === "}") {
        depth -= 1;
        if (depth === 0) { close = index; break; }
      }
    }
    if (close < 0) break;
    const entryBody = input.slice(open + 1, close);
    const separator = entryBody.indexOf(",");
    if (separator > 0) {
      const key = entryBody.slice(0, separator).trim();
      const fields = parseFields(entryBody.slice(separator + 1));
      if (fields.title) {
        const authors = (fields.author ?? "").split(/\s+and\s+/i).map(cleanBibValue).filter(Boolean);
        const doi = fields.doi?.toLowerCase();
        references.push({
          ...(doi ? { doi } : {}),
          ...(fields.eprint ? { arxivId: fields.eprint } : {}),
          title: fields.title,
          authors,
          ...(parseYear(fields.year) ? { year: parseYear(fields.year) } : {}),
          ...(fields.journal || fields.booktitle ? { venue: fields.journal ?? fields.booktitle } : {}),
          ...(fields.url ? { url: fields.url } : {}),
          rawMeta: { key, entryType: input.slice(at + 1, open).trim().toLowerCase(), fields },
        });
      }
    }
    cursor = close + 1;
  }
  return references;
}
