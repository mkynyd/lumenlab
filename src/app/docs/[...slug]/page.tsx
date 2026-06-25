import { notFound } from "next/navigation";
import {
  DOCS_NAV,
  extractHeadings,
  extractTitle,
  findDocBySlug,
  getDocNeighbors,
  readDocFile,
  rewriteDocLinks,
} from "@/lib/docs/docs-data";
import { DocsPage } from "@/components/docs/docs-page";

interface DocsPageParams {
  params: Promise<{ slug: string[] }>;
}

export function generateStaticParams(): { slug: string[] }[] {
  return DOCS_NAV.flatMap((section) =>
    section.items
      .filter((item) => item.slug !== "")
      .map((item) => ({
        slug: item.slug.split("/"),
      }))
  );
}

export async function generateMetadata({ params }: DocsPageParams) {
  const { slug } = await params;
  const doc = findDocBySlug(slug);
  if (!doc) return { title: "文档" };
  const content = await readDocFile(doc.filePath);
  const title = extractTitle(content);
  return {
    title: `${title} · 文档`,
  };
}

export default async function DocsSlugPage({ params }: DocsPageParams) {
  const { slug } = await params;
  const doc = findDocBySlug(slug);
  if (!doc) {
    notFound();
  }

  const rawContent = await readDocFile(doc.filePath);
  const content = rewriteDocLinks(rawContent);
  const headings = extractHeadings(content);
  const { prev, next } = getDocNeighbors(slug);

  return <DocsPage content={content} headings={headings} prev={prev} next={next} />;
}
