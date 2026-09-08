import { ResearchWorkspaceView } from "@/components/research/research-workspace";

export default async function ResearchWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResearchWorkspaceView workspaceId={id} />;
}
