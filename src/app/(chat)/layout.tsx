import { FeedbackWidget } from "@/components/feedback/feedback-widget";
import { ChatShell } from "@/components/layout/chat-shell";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChatShell
      learningNavigationVisible={true}
    >
      {children}
      <FeedbackWidget />
    </ChatShell>
  );
}
