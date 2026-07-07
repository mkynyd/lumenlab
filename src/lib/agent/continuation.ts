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
  classifyFailure,
  type PlannedToolCall,
  type PlannedToolRunResult,
  type FailureCategory,
  type FailureRecord,
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

## 工具列表与决策规则

### project_files.list
- 使用条件：需要确认项目中有哪些可用资料；用户要求列出或浏览资料；不确定目标文件名时先列出再读取。
- 不使用条件：已明确知道要读取的文件名；用户问题不涉及项目资料；上一轮刚列过且文件列表未变化。
- 失败后：不重试。告知用户资料列表暂时不可用，询问是否手动提供文件名。

### project_files.read
- 使用条件：回答需要某个项目文件的具体内容；用户引用或提及了项目中的文件；project_rag 搜索结果需要核对原文细节。
- 不使用条件：用户已粘贴了文件全部内容；问题只需要文件的标题或元信息；RAG 片段已充分覆盖问题。
- 失败后：参数错误（如 fileId 不存在）可换用 project_files.list 确认正确 ID；读取超时可减小 maxChars 重试一次；权限错误不得重试，告知用户该文件不可读。

### project_rag.search
- 使用条件：回答依赖项目资料且当前上下文未包含原文；需要在多个文件中定位相关信息；用户问题涉及跨文件的知识点。
- 不使用条件：用户已粘贴足够回答的内容；问题只需要通用解释而非项目特定信息；已知目标文件且文件较短时直接用 project_files.read。
- 失败后：换用 project_files.list + project_files.read 逐文件查找；如项目无资料，明确告知并建议上传。

### web.search
- 使用条件：用户询问时事、最新政策、近期发布、实时数据；需要核实外部事实或数据；项目资料没有相关信息且超出训练数据范围。
- 不使用条件：问题属于稳定的基础知识（数学定义、编程语法、学科教科书内容）；用户已提供完整材料；纯观点讨论、创意写作、格式改写。
- 失败后：网络暂时失败可尝试 web.fetch 替代；持续失败则明确告知搜索结果不可用，基于已有知识给出标注了不确定性的回答。

### web.fetch
- 使用条件：需要读取特定网页的完整内容；web.search 返回了摘要但需要原文细节。
- 不使用条件：URL 不确定或来自不可信来源；web.search 摘要已足够回答问题。
- 失败后：不重试同一 URL。尝试 web.search 找替代来源；持续失败则告知该网页不可访问。

### arxiv.search / arxiv.read / arxiv.fetch
- 使用条件：用户明确涉及学术论文或 arXiv 文献；需要论文摘要、作者、发表信息。
- 不使用条件：用户未提及论文；可以通过 web.search 获取的信息不需要走 arXiv 专用通道。
- 失败后：降级到 web.search 搜索同一论文；告知用户 arXiv 接口不可用。

### artifact.save
- 使用条件：用户明确要求保存或导出内容；对话产生了有价值的分析结果且用户可能后续引用。
- 不使用条件：用户没有保存意图；内容是临时性的聊天草稿。此操作涉及写入，确认用户意图后再调用。
- 失败后：告知保存失败及原因，询问是否重试。不得反复重试同一保存操作。

### artifact.list / reference.list
- 使用条件：用户询问已保存了哪些成果或参考文献；需要关联已有成果到当前讨论。
- 不使用条件：对话刚开始且显然没有已保存内容；用户问题与成果无关。
- 失败后：不重试。告知列表暂不可用。

### reference.add / reference.attach / reference.format
- 使用条件：用户明确要求管理参考文献；生成的内容需要格式化引用。
- 不使用条件：用户未提及引文管理。涉及写入，确认意图后再调用。
- 失败后：告知操作失败及原因，不自动重试。

## 通用规则
- 工具调用失败不要原样重复。参数错误修正后最多重试一次；网络错误换来源或降级；权限/不存在类错误放弃该路径，用已有信息继续。
- 同一工具用相同参数调用两次即为冗余。如果第二次没有新的参数信息，停止调用该工具。
- 如果不需调用工具，直接回答用户问题。不要在没有工具结果的情况下虚构数据。
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

/** 根据失败类别生成结构化的错误提示，包含恢复指导 */
function formatFailureMessage(
  call: PlannedToolCall,
  error: string,
  category: FailureCategory
): string {
  const guidance: Record<FailureCategory, string> = {
    invalid_params:
      "此错误可能是参数格式问题。请检查输入参数后重试一次，不要再用相同的错误参数调用此工具。",
    transient:
      "此错误由网络或服务暂时不可用引起。可以尝试换用替代工具或来源，不需要用相同参数重试。",
    permission:
      "此错误表示没有权限执行该操作。不要重试此调用。请告知用户权限不足，改用已有信息继续回答。",
    not_found:
      "请求的资源不存在。不要重试此调用。请告知用户资源不可用，基于已有信息继续回答。",
    rate_limited:
      "请求频率过高被限制。可以在几秒后重试一次，或用替代工具。",
    internal_error:
      "服务端错误。不要立即重试。可以尝试降级路径或用已有信息继续。",
  };

  return `## 工具调用失败：${call.name}

- 参数：${JSON.stringify(call.input)}
- 错误信息：${error}
- 失败类别：${category}
- 恢复指导：${guidance[category]}`;
}

export async function runContinuationLoop(
  inputs: ContinuationInputs
): Promise<ContinuationResult> {
  const sources: AgentSource[] = [];
  const history: Array<{ toolId: string; args: Record<string, unknown>; producedNewContent: boolean }> = [];
  const recentFailures: FailureRecord[] = [];
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
        stopReason: stopReason ?? "model_ceased_calling_tools",
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
        recentFailures,
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
        const category = classifyFailure(result.error);
        toolResultSummaries.push(
          formatFailureMessage(call, result.error, category)
        );
        history.push({
          toolId: call.name,
          args: call.input,
          producedNewContent: false,
        });
        recentFailures.push({ toolId: call.name, category, round });
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
