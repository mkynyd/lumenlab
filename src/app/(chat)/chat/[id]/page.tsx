import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ChatArea } from "@/components/chat/chat-area";

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

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          reasoningContent: true,
          tokenCount: true,
          cacheHitTokens: true,
          cacheMissTokens: true,
        },
      },
    },
  });

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
