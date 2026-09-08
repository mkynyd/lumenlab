import { vi } from "vitest";
import type { ResponsesStreamEvent, ResponsesRequestBody } from "../providers/responses/types";
import type { ToolMetadata } from "../types";

export const params = {
  messages: [{ role: "system", content: "系统" }, { role: "user", content: "问题" }],
  thinkingEnabled: true, reasoningEffort: "max" as const,
};
export const image = { name: "diagram.png", mimeType: "image/png", size: 3, data: Buffer.from("png") };
export const completed: ResponsesStreamEvent = { type: "response.completed", response: {
  status: "completed", usage: { input_tokens: 10, output_tokens: 4, input_tokens_details: { cached_tokens: 3 } },
} };
export function call(id = "c1", name = "project_files.list"): ResponsesStreamEvent {
  return { type: "response.output_item.done", item: { type: "function_call", id: `item-${id}`, call_id: id, name, arguments: '{"projectId":"p1"}' } };
}
export function mockSse(events: ResponsesStreamEvent[] = [completed]) {
  const requests: Array<{ url: string; body: ResponsesRequestBody; signal?: AbortSignal | null }> = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal });
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}
export function tool(toolId: string): ToolMetadata {
  return { toolId, name: toolId, description: `${toolId} description`, inputSchema: { type: "object", properties: {} }, outputSchema: {}, riskLevel: "L1", isReadOnly: true, hasExternalSideEffect: false, isReversible: true, containsSensitiveData: false, requiresNetwork: false, defaultApprovalMode: "auto", allowedSkillIds: [], auditLevel: "standard", requiredScopes: [] };
}
export async function collect<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  const result: T[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return result;
      result.push(next.value);
    }
  } finally { reader.releaseLock(); }
}
