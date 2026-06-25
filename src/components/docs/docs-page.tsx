import { DocsMarkdown } from "@/components/docs/docs-markdown";
import { DocsToc } from "@/components/docs/docs-toc";
import { DocsFooterNav } from "@/components/docs/docs-footer-nav";
import type { DocHeading, DocNavItem } from "@/lib/docs/docs-nav";

interface DocsPageProps {
  content: string;
  headings: DocHeading[];
  prev: DocNavItem | null;
  next: DocNavItem | null;
}

export function DocsPage({ content, headings, prev, next }: DocsPageProps) {
  return (
    <div className="mx-auto flex max-w-7xl gap-8">
      <article className="min-w-0 flex-1">
        <DocsMarkdown content={content} />
        <DocsFooterNav prev={prev} next={next} />
      </article>
      <DocsToc headings={headings} />
    </div>
  );
}
