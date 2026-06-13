import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ChatArea } from "@/components/chat/chat-area";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  // Check if user has an API key configured
  const apiKey = await prisma.apiKey.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (!apiKey) {
    redirect("/settings?setup=true");
  }

  return (
    <div className="h-full flex flex-col">
      <ChatArea />
    </div>
  );
}
