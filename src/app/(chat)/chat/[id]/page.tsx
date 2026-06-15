import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { ChatArea } from "@/components/chat/chat-area";
import { getConversation } from "@/lib/data/conversations";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;

  const conversation = await getConversation(id, session.user.id);

  if (!conversation) {
    notFound();
  }

  return (
    <div className="h-full flex flex-col">
      <ChatArea
        initialConversationId={conversation.id}
        initialMessages={conversation.messages}
      />
    </div>
  );
}
