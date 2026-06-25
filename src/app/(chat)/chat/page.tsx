import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChatArea } from "@/components/chat/chat-area";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/home");
  }

  return (
    <div className="h-full flex flex-col">
      <ChatArea />
    </div>
  );
}
