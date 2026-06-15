import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChatArea } from "@/components/chat/chat-area";
import { getProviderApiKey } from "@/lib/data/provider-access";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  try {
    await getProviderApiKey(session.user.id, "deepseek");
  } catch {
    redirect("/settings?access=unavailable");
  }

  return (
    <div className="h-full flex flex-col">
      <ChatArea />
    </div>
  );
}
