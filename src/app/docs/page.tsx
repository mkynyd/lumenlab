import {
  extractHeadings,
  flattenNav,
  readDocFile,
  rewriteDocLinks,
} from "@/lib/docs/docs-data";
import { DocsPage } from "@/components/docs/docs-page";

export const metadata = {
  title: "文档 · LumenLab",
};

export default async function DocsHomePage() {
  const rawContent = await readDocFile("README.md");
  const content = rewriteDocLinks(rawContent);
  const headings = extractHeadings(content);
  const items = flattenNav();
  const next = items[0] ?? null;

  return <DocsPage content={content} headings={headings} prev={null} next={next} />;
}
