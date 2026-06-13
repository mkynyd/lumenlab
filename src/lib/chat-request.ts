import type { ProjectType } from "@/components/chat/quick-task-bar";

export interface ChatRequestInput {
  conversationId?: string;
  message: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  projectId?: string;
  selectedFileIds?: string[];
  mode?: ProjectType;
}

export function buildChatRequestBody(input: ChatRequestInput): ChatRequestInput {
  const body: ChatRequestInput = {
    conversationId: input.conversationId,
    message: input.message,
    model: input.model,
    thinkingEnabled: input.thinkingEnabled,
    reasoningEffort: input.reasoningEffort,
  };

  if (input.projectId) {
    body.projectId = input.projectId;
    body.selectedFileIds = input.selectedFileIds ?? [];
    if (input.mode) {
      body.mode = input.mode;
    }
  }

  return body;
}
