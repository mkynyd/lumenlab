import type { ProjectType } from "@/components/chat/quick-task-bar";

export interface ChatRequestInput {
  conversationId?: string;
  message: string;
  hiddenPrompt?: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  projectId?: string;
  selectedFileIds?: string[];
  mode?: ProjectType;
  webSearchActive?: boolean;
  manualSkillId?: string;
  skillOff?: boolean;
}

export function buildChatRequestBody(input: ChatRequestInput): ChatRequestInput {
  const body: ChatRequestInput = {
    conversationId: input.conversationId,
    message: input.message,
    model: input.model,
    thinkingEnabled: input.thinkingEnabled,
    reasoningEffort: input.reasoningEffort,
  };

  if (input.hiddenPrompt) {
    body.hiddenPrompt = input.hiddenPrompt;
  }

  if (input.projectId) {
    body.projectId = input.projectId;
    body.selectedFileIds = input.selectedFileIds ?? [];
    if (input.mode) {
      body.mode = input.mode;
    }
  }

  if (input.webSearchActive) {
    body.webSearchActive = input.webSearchActive;
  }

  if (input.manualSkillId) {
    body.manualSkillId = input.manualSkillId;
  }

  if (input.skillOff) {
    body.skillOff = input.skillOff;
  }

  return body;
}
