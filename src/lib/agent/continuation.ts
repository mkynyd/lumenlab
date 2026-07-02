/**
 * Agent Orchestrator model-driven continuation loop.
 *
 * After deterministic prefetch tools have run, this loop lets the model decide
 * whether additional tools are needed. It parses JSON action blocks from the
 * model output, executes them through the same policy/audit path, and re-prompts
 * until a final answer is reached or a stop condition fires.
 *
 * Current provider support:
 * - DeepSeek: non-streaming completion via `completeChat`, JSON action fallback.
 * - MiniMax: not yet supported; stays on prefetch-only path.
 */

import type { DeepSeekMessage } from "@/lib/deepseek";
import { completeChat } from "@/lib/deepseek";
import type { AgentEvent } from "./types";
import type { TaskProfile } from "./skill-router";
import {
  aggregateSources,
  extractSourcesFromToolResult,
  type AgentSource,
} from "./sources";
import {
  shouldStopToolLoop,
  toolResultProducedNewContent,
  getToolRoundLimit,
  type PlannedToolCall,
  type PlannedToolRunResult,
} from "./orchestrator";

export interface ContinuationInputs {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: DeepSeekMessage[];
  profile: TaskProfile;
  runTool: (call: PlannedToolCall) => Promise<PlannedToolRunResult>;
  emit: (event: AgentEvent) => void;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
}

export interface ContinuationResult {
  finalMessages: DeepSeekMessage[];
  sources: AgentSource[];
  stopReason: string | null;
}

const JSON_ACTION_INSTRUCTION = `
你可以调用工具来获取更多信息。如果需要调用工具，请在回复末尾输出一个 JSON 代码块，格式如下：

\`\`\`json
{
  "tool_calls": [
    {"name": "tool.id", "input": {"key": "value"}}
  ]
}
\`\`\`

可用工具：
- project_files.list: 列出当前项目资料。输入 { projectId?: string }
- project_files.read: 读取当前项目资料。输入 { projectId?: string, fileId: string, maxChars?: number }
- project_rag.search: 在当前项目资料中搜索。输入 { projectId?: string, query: string, maxResults?: number }
- web.search: 联网搜索。输入 { query: string, maxResults?: number }
- web.fetch: 抓取公开网页。输入 { url: string }
- arxiv.search: arXiv 搜索。输入 { query: string, maxResults?: number }
- arxiv.read: 读取 arXiv 论文元数据。输入 { arxivId: string }
- arxiv.fetch: 抓取 arXiv 页面。输入 { url: string }
- artifact.save: 保存为成果。输入 { title: string, content: string, type?: string }
- artifact.list: 列出成果。输入 { projectId?: string, conversationId?: string }
- reference.add: 添加参考文献。输入 { projectId?: string, title: string, ... }
- reference.list: 列出参考文献。输入 { projectId?: string, conversationId?: string }
- reference.attach: 挂载引用到成果。输入 { artifactId: string, referenceId: string }
- reference.format: 格式化引用。输入 { artifactId: string, format: string }

如果不需调用工具，直接回答用户问题即可。不要在没有工具结果的情况下虚构数据。
`;

const JSON_ACTION_BLOCK = /```json\s*\n?([\s\S]*?)\n?```/;

function extractJsonActions(content: string): PlannedToolCall[] {
  const match = JSON_ACTION_BLOCK.exec(content);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object") return [];
    const calls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
    return calls
      .filter(
        (call: unknown): call is { name: string; input?: Record<string, unknown> } =>
          typeof call === "object" &&
          call !== null &&
          "name" in call &&
          typeof (call as { name: string }).name === "string"
      )
      .map((call: { name: string; input?: Record<string, unknown> }, index: number) => ({
        id: `continuation-tool-call-${index + 1}`,
        name: call.name as PlannedToolCall["name"],
        input: call.input ?? {},
      }));
  } catch {
    return [];
  }
}

function stripJsonActionBlock(content: string): string {
  return content.replace(JSON_ACTION_BLOCK, "").trim();
}

function summarizeToolResult(call: PlannedToolCall, result: Record<string, unknown>) {
  const compact = JSON.stringify(result, null, 2);
  return `## ${call.name}\n\n参数：${JSON.stringify(call.input)}\n\n结果：\n${compact.slice(0, 8000)}`;
}

export async function runContinuationLoop(
  inputs: ContinuationInputs
): Promise<ContinuationResult> {
  const sources: AgentSource[] = [];
  const history: Array<{ toolId: string; args: Record<string, unknown>; producedNewContent: boolean }> = [];
  let messages = [...inputs.messages];
  let stopReason: string | null = null;

  const systemWithTools = `${inputs.systemPrompt}\n\n${JSON_ACTION_INSTRUCTION}`;

  for (let round = 0; round < getToolRoundLimit(inputs.profile); round += 1) {
    const response = await completeChat(inputs.apiKey, {
      model: inputs.model,
      messages: messages.map((m) =>
        m.role === "system" && m === messages[0] ? { ...m, content: systemWithTools } : m
      ),
      thinking: inputs.thinkingEnabled ? { type: "enabled" } : { type: "disabled" },
      reasoning_effort: inputs.reasoningEffort,
      max_tokens: 4096,
    });

    const strippedContent = stripJsonActionBlock(response.content);
    const toolCalls = extractJsonActions(response.content);

    if (toolCalls.length === 0) {
      // Model produced a final answer with no further tool calls.
      return {
        finalMessages: [
          ...messages,
          {
            role: "assistant",
            content: strippedContent,
            ...(response.reasoningContent
              ? { reasoning_content: response.reasoningContent }
              : {}),
          },
        ],
        sources: aggregateSources(sources),
        stopReason,
      };
    }

    // Record assistant message with the tool call plan.
    messages = [
      ...messages,
      {
        role: "assistant",
        content: strippedContent || `调用工具：${toolCalls.map((c) => c.name).join(", ")}`,
        ...(response.reasoningContent ? { reasoning_content: response.reasoningContent } : {}),
      },
    ];

    const toolResultSummaries: string[] = [];
    for (const call of toolCalls) {
      const stop = shouldStopToolLoop({
        profile: inputs.profile,
        round,
        history,
      });
      if (stop.stop) {
        stopReason = stop.reason;
        break;
      }

      const result = await inputs.runTool(call);
      if (result.status === "succeeded" && result.summary) {
        toolResultSummaries.push(summarizeToolResult(call, result.summary));
        sources.push(...extractSourcesFromToolResult(call.name, result.summary));
        history.push({
          toolId: call.name,
          args: call.input,
          producedNewContent: toolResultProducedNewContent(result.summary),
        });
      } else if (result.status === "failed") {
        toolResultSummaries.push(
          `## ${call.name}\n\n参数：${JSON.stringify(call.input)}\n\n结果：工具执行失败：${result.error}`
        );
        history.push({
          toolId: call.name,
          args: call.input,
          producedNewContent: false,
        });
      }
    }

    if (stopReason) {
      break;
    }

    messages = [
      ...messages,
      {
        role: "user",
        content: `# 工具结果\n\n${toolResultSummaries.join("\n\n")}\n\n请基于这些结果继续回答用户问题。如果还需要其他工具，可以继续输出 JSON action block。`,
      },
    ];
  }

  // Round limit reached — do one final completion to produce an answer.
  const finalResponse = await completeChat(inputs.apiKey, {
    model: inputs.model,
    messages: messages.map((m) =>
      m.role === "system" && m === messages[0] ? { ...m, content: systemWithTools } : m
    ),
    thinking: inputs.thinkingEnabled ? { type: "enabled" } : { type: "disabled" },
    reasoning_effort: inputs.reasoningEffort,
    max_tokens: 4096,
  });

  return {
    finalMessages: [
      ...messages,
      {
        role: "assistant",
        content: stripJsonActionBlock(finalResponse.content),
        ...(finalResponse.reasoningContent
          ? { reasoning_content: finalResponse.reasoningContent }
          : {}),
      },
    ],
    sources: aggregateSources(sources),
    stopReason: stopReason ?? "round_limit",
  };
}
