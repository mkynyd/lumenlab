import { ChatShell } from "@/components/layout/chat-shell";
import { learningFeatureFlags } from "@/lib/learning/feature-flags";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChatShell
      learningNavigationVisible={learningFeatureFlags.navigationVisible}
    >
      {children}
    </ChatShell>
  );
}
