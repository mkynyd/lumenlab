import fs from "fs/promises";
import path from "path";

const DOCS_ROOT = path.join(process.cwd(), "docs", "LumenLabDocs");

export async function readDocFile(filePath: string): Promise<string> {
  const fullPath = path.join(DOCS_ROOT, filePath);
  return fs.readFile(fullPath, "utf-8");
}

export {
  DOCS_NAV,
  flattenNav,
  findDocBySlug,
  findDocByFilePath,
  getDocNeighbors,
  extractTitle,
  extractHeadings,
  rewriteDocLinks,
} from "./docs-nav";

export type { DocSection, DocNavItem, DocHeading } from "./docs-nav";
