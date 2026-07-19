import { notFound } from "next/navigation";

import { ExportReadyMarker } from "@/components/tools/export-ready-marker";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function ArtifactPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const { id } = await params;
  const artifact = await prisma.artifact.findFirst({
    where: { id, userId: session.user.id },
    select: { title: true, content: true },
  });
  if (!artifact) notFound();

  return (
    <main data-artifact-print data-export-print className="mx-auto w-full max-w-4xl bg-white px-2 py-1 text-black">
      <h1 className="mb-6 text-2xl font-bold">{artifact.title}</h1>
      <MarkdownContent content={artifact.content} imageLoading="eager" />
      <ExportReadyMarker />
    </main>
  );
}
