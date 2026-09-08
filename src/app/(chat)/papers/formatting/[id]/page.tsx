import { PaperFormattingDetail } from "@/components/paper/paper-formatting-detail";

export default async function PaperFormattingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaperFormattingDetail taskId={id} />;
}
