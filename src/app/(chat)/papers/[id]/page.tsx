import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseAcademicDocument, type DocumentBlock } from "@/lib/paper/document-schema";
import { PaperPdfViewer } from "@/components/paper/paper-pdf-viewer";

const outlineText = (block: DocumentBlock) => {
  if ("children" in block) {
    const walk = (nodes: unknown): string => Array.isArray(nodes) ? nodes.map(walk).join("") : nodes && typeof nodes === "object" ? (typeof (nodes as { text?: unknown }).text === "string" ? (nodes as { text: string }).text : walk((nodes as { children?: unknown }).children)) : "";
    return walk(block.children);
  }
  if (block.kind === "table") return block.columns.join(" · ");
  if (block.kind === "figure") return block.caption ?? "图片";
  if (block.kind === "equation") return block.latex;
  if (block.kind === "bibliography") return `${block.referenceIds.length} 条参考文献`;
  if (block.kind === "raw_latex") return block.latex;
  return block.kind;
};

/** Legacy documents stay readable and exportable; every editing entry point is retired. */
export default async function PaperArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id) return <main className="h-full overflow-y-auto bg-[var(--color-bg)]"><div className="mx-auto max-w-3xl px-5 py-10 sm:px-8"><p className="text-sm text-[var(--color-text-secondary)]">请先登录后查看论文。</p><Link href="/login" className="mt-4 inline-block text-xs text-[var(--color-accent)] hover:underline">去登录</Link></div></main>;
  const workspace = await prisma.paperWorkspace.findFirst({ where: { id, userId: session.user.id }, include: { project: { select: { name: true } }, document: { include: { currentVersion: true } } } });
  if (!workspace) notFound();
  const document = workspace.document;
  const content = document?.currentVersion ? parseAcademicDocument(document.currentVersion.content) : null;
  const compilation = document?.currentVersionId ? await prisma.paperCompilation.findFirst({ where: { documentVersionId: document.currentVersionId, status: "succeeded" }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null;
  const blocks = content?.blocks.filter((block) => block.kind !== "paper_metadata") ?? [];

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <Link href="/papers" className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">返回论文排版</Link>
        <h1 className="mt-5 truncate text-2xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">{workspace.name}</h1>
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{workspace.project?.name ? `项目：${workspace.project.name}` : "独立论文工作区"} · 历史论文为只读，编辑入口已下线</p>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className="bg-[var(--color-panel)] px-5 py-5">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">只读大纲</h2>
            {blocks.length === 0 ? <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">这篇论文还没有正文内容。</p> : <ol className="mt-3 space-y-1.5">{blocks.map((block, index) => <li key={index} className="flex gap-2 text-xs text-[var(--color-text-secondary)]"><span className="shrink-0 text-[var(--color-text-tertiary)]">{index + 1}</span><span className="min-w-0 truncate">{block.kind === "heading" ? `# ${outlineText(block)}` : outlineText(block)}</span></li>)}</ol>}
            <p className="mt-4 text-[11px] text-[var(--color-text-tertiary)]">需要重新排版？<Link href="/papers/typesetting" className="text-[var(--color-accent)] hover:underline">上传原稿创建新的排版任务</Link></p>
          </section>
          <section className="bg-[var(--color-panel)] px-5 py-5">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">历史 PDF</h2>
            {compilation ? <PaperPdfViewer pdfUrl={`/api/papers/compilations/${compilation.id}/pdf`} /> : <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">这篇论文没有可预览的编译结果。</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
