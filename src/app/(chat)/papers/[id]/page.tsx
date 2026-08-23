import { PaperWorkspaceView } from "@/components/paper/paper-workspace";

export default async function PaperWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaperWorkspaceView workspaceId={id} />;
}
