import { createHash } from "node:crypto";

type JsonScalar = null | boolean | number | string;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

export interface AgentExecutionRequestHashInput {
  conversationId?: string;
  message: string;
  hiddenPrompt?: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  projectId?: string;
  selectedFiles: Array<{
    id: string;
    contentFingerprint: string;
  }>;
  attachments: Array<{
    name: string;
    mimeType: string;
    contentFingerprint: string;
  }>;
  options: Record<string, JsonValue | undefined>;
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function omitUndefined(
  value: Record<string, JsonValue | undefined>
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, JsonValue] => entry[1] !== undefined
    )
  );
}

export function buildAgentExecutionRequestHash(
  input: AgentExecutionRequestHashInput
): string {
  const normalized: JsonValue = {
    ...(input.conversationId
      ? { conversationId: input.conversationId }
      : {}),
    message: input.message,
    ...(input.hiddenPrompt ? { hiddenPrompt: input.hiddenPrompt } : {}),
    model: input.model,
    thinkingEnabled: input.thinkingEnabled,
    reasoningEffort: input.reasoningEffort,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    selectedFiles: [...input.selectedFiles]
      .sort(
        (left, right) =>
          left.id.localeCompare(right.id) ||
          left.contentFingerprint.localeCompare(right.contentFingerprint)
      )
      .map((file) => ({
        id: file.id,
        contentFingerprint: file.contentFingerprint,
      })),
    attachments: [...input.attachments]
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.mimeType.localeCompare(right.mimeType) ||
          left.contentFingerprint.localeCompare(right.contentFingerprint)
      )
      .map((attachment) => ({
        name: attachment.name,
        mimeType: attachment.mimeType,
        contentFingerprint: attachment.contentFingerprint,
      })),
    options: omitUndefined(input.options),
  };

  return `sha256:${createHash("sha256")
    .update(canonicalize(normalized))
    .digest("hex")}`;
}
