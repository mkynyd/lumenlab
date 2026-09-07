/**
 * Serialization between the internal `DeepSeekMessage` transcript and
 * Responses API items, the normalized stream-event accumulator, and the
 * per-provider request body builders.
 *
 * Accumulator guarantees (contract 01.5 / 01.6 / 01.7):
 * - Text and reasoning are accumulated raw and emitted through the same
 *   full-text clean-and-slice path the legacy adapters use, so sanitization
 *   stays identical.
 * - `*.done` payloads only fill in fragments the deltas missed; a done text
 *   is never appended on top of already-emitted deltas.
 * - Function calls accumulate `arguments` keyed by `item_id` /
 *   `output_index` and pair with their `call_id`; identical name/arguments
 *   under different call ids are never merged or dropped.
 * - `response.completed` / `response.incomplete` / `response.failed` (and
 *   content-filter / refusal outcomes) are distinct terminal states, each
 *   carrying usage when the provider sent it.
 * - EOF without a terminal event throws `ResponsesStreamInterruptedError`;
 *   a truncated stream is never reported as success.
 */
import type { AdapterUsage } from "@/lib/agent/provider-adapter";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import { isTextAttachment, type ServerFileAttachment } from "@/lib/chat/router";
import type { DeepSeekMessage } from "@/lib/deepseek";
import { ResponsesStreamInterruptedError } from "./transport";
import type {
  ResponsesInputContentPart,
  ResponsesFunctionCallItem,
  ResponsesFunctionCallOutputItem,
  ResponsesFunctionTool,
  ResponsesInputItem,
  ResponsesMessageItem,
  ResponsesOutputItem,
  ResponsesReasoningEffort,
  ResponsesRequestBody,
  ResponsesResponsePayload,
  ResponsesStreamEvent,
  ResponsesToolChoice,
  ResponsesUsage,
} from "./types";

export class ResponsesSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponsesSerializationError";
  }
}

/** Reversible encoding: tool ids such as project_files.list contain dots,
 * while Responses function names only accept letters, numbers, _ and -.
 */
export function toResponsesToolName(name: string): string {
  const encoded = name.replace(/_/g, "_u").replace(/\./g, "_d");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(encoded)) {
    throw new ResponsesSerializationError(`工具名称不符合 Responses 限制：${name}`);
  }
  return encoded;
}

export function fromResponsesToolName(name: string): string {
  return name.replace(/_([ud])/g, (_, escaped: string) => escaped === "u" ? "_" : ".");
}

function encodeFunctionNames(body: ResponsesRequestBody): void {
  if (body.tools) body.tools = body.tools.map((tool) => ({ ...tool, name: toResponsesToolName(tool.name) }));
  body.input = body.input.map((item) => item.type === "function_call"
    ? { ...item, name: toResponsesToolName(item.name) } : item);
  if (typeof body.tool_choice === "object") {
    body.tool_choice = body.tool_choice.type === "function"
      ? { ...body.tool_choice, name: toResponsesToolName(body.tool_choice.name) }
      : { ...body.tool_choice, tools: body.tool_choice.tools.map((tool) => ({ ...tool, name: toResponsesToolName(tool.name) })) };
  }
}

// ---------------------------------------------------------------------------
// Request serialization: DeepSeekMessage[] + attachments -> instructions/input
// ---------------------------------------------------------------------------

export interface SerializedResponsesInput {
  instructions?: string;
  input: ResponsesInputItem[];
}

/**
 * System messages become top-level `instructions` (supported by all three
 * providers and documented as the stable per-request system channel). User
 * and assistant history becomes message items; `tool_use` / `tool_result`
 * blocks become `function_call` / `function_call_output` items paired by id.
 */
export function messagesToInputItems(
  messages: DeepSeekMessage[],
  attachments?: ServerFileAttachment[]
): SerializedResponsesInput {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => messageText(message.content))
    .filter((text) => text.length > 0)
    .join("\n\n");

  const input: ResponsesInputItem[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant") {
      input.push(...assistantItems(message));
    } else {
      const items = userItems(message);
      const media = attachmentsToContentParts(message.attachments ?? []);
      if (media.length) {
        const target = lastUserMessageItem(items);
        target.content = [...asPartArray(target.content), ...media];
      }
      input.push(...items);
    }
  }

  const mediaParts = attachmentsToContentParts(attachments ?? []);
  if (mediaParts.length > 0) {
    const target = lastUserMessageItem(input);
    target.content = [...asPartArray(target.content), ...mediaParts];
  }

  return instructions ? { instructions, input } : { input };
}

/**
 * Non-text attachments become multimodal content parts for the last user
 * message, matching the legacy "attach to last user turn" behavior.
 *
 * PDF/DOCX and scanned-PDF page images are resolved upstream by
 * `resolveChatDocumentAttachments` (task 03): text PDFs/DOCX are inlined as
 * prompt text there and scanned PDFs arrive here already as PNG parts. Any
 * other document format reaching this layer has no extraction path and stays
 * fail-closed instead of degrading to a filename placeholder.
 */
export function attachmentsToContentParts(
  attachments: ServerFileAttachment[]
): ResponsesInputContentPart[] {
  const parts: ResponsesInputContentPart[] = [];
  for (const attachment of attachments) {
    // Text attachments are inlined into the prompt upstream and never reach
    // the media channel.
    if (isTextAttachment(attachment)) continue;
    if (attachment.mimeType.startsWith("image/")) {
      parts.push({
        type: "input_image",
        image_url: `data:${attachment.mimeType};base64,${attachment.data.toString("base64")}`,
      });
      continue;
    }
    if (attachment.mimeType.startsWith("video/") || attachment.mimeType.startsWith("audio/")) {
      throw new ResponsesSerializationError(
        attachment.mimeType.startsWith("video/")
          ? "Responses 路径暂不支持视频输入；视频理解请选择 Qwen 模型后重试"
          : "Responses 暂不支持音频输入，请使用文字或图片"
      );
    }
    throw new ResponsesSerializationError(
      `暂不支持 ${attachment.mimeType || attachment.name} 附件，请转换为 PDF、DOCX 或图片后重试`
    );
  }
  return parts;
}

export interface ResponsesToolSpecInput {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

/** Maps the internal tool schema (`input_schema`) to Responses `parameters`. */
export function toResponsesFunctionTool(
  tool: ResponsesToolSpecInput
): ResponsesFunctionTool {
  return {
    type: "function",
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.input_schema ?? { type: "object", properties: {} },
  };
}

function messageText(content: DeepSeekMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

function assistantItems(message: DeepSeekMessage): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  if (message.reasoning_content) {
    items.push({
      type: "reasoning",
      content: [{ type: "reasoning_text", text: message.reasoning_content }],
    });
  }
  const parts: ResponsesInputContentPart[] = [];
  const calls: ResponsesFunctionCallItem[] = [];
  if (typeof message.content === "string") {
    if (message.content) {
      parts.push({ type: "output_text", text: message.content });
    }
  } else {
    for (const block of message.content) {
      if (block.type === "text" && block.text) {
        parts.push({ type: "output_text", text: block.text });
      }
      if (block.type === "tool_use") {
        calls.push({
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        });
      }
    }
  }
  if (parts.length > 0) {
    items.push({ role: "assistant", content: parts });
  }
  // DeepSeek merges function_call items into the adjacent assistant message;
  // all three providers accept the separate-item form used here.
  items.push(...calls);
  return items;
}

function userItems(message: DeepSeekMessage): ResponsesInputItem[] {
  const role = message.role === "developer" ? "developer" : "user";
  const parts: ResponsesInputContentPart[] = [];
  const outputs: ResponsesFunctionCallOutputItem[] = [];
  if (typeof message.content === "string") {
    if (message.content) {
      parts.push({ type: "input_text", text: message.content });
    }
  } else {
    for (const block of message.content) {
      if (block.type === "text" && block.text) {
        parts.push({ type: "input_text", text: block.text });
      }
      if (block.type === "tool_result") {
        outputs.push({
          type: "function_call_output",
          call_id: block.tool_use_id,
          output: block.content,
        });
      }
    }
  }
  const items: ResponsesInputItem[] = [];
  if (parts.length > 0) items.push({ role, content: parts });
  items.push(...outputs);
  return items;
}

function lastUserMessageItem(input: ResponsesInputItem[]): ResponsesMessageItem {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (
      (item.type === undefined || item.type === "message") &&
      (item as ResponsesMessageItem).role === "user"
    ) {
      return item as ResponsesMessageItem;
    }
  }
  const created: ResponsesMessageItem = { role: "user", content: [] };
  input.push(created);
  return created;
}

function asPartArray(
  content: ResponsesMessageItem["content"]
): ResponsesInputContentPart[] {
  if (Array.isArray(content)) return content;
  return content ? [{ type: "input_text", text: content }] : [];
}

// ---------------------------------------------------------------------------
// Usage mapping
// ---------------------------------------------------------------------------

export interface ResponsesAdapterUsage extends AdapterUsage {
  /**
   * Included in `completion_tokens` already; exposed for display only and
   * never billed a second time.
   */
  reasoning_tokens?: number;
}

/**
 * Maps Responses usage onto the legacy adapter shape. `input_tokens` includes
 * cached tokens on all three providers. Missing cache measurements stay
 * absent; the billing layer may conservatively price the input as uncached.
 */
export function mapResponsesUsage(usage: ResponsesUsage): ResponsesAdapterUsage {
  const cached = usage.input_tokens_details?.cached_tokens;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens ?? usage.input_tokens + usage.output_tokens,
    ...(cached !== undefined ? {
      prompt_cache_hit_tokens: cached,
      prompt_cache_miss_tokens: Math.max(0, usage.input_tokens - cached),
    } : {}),
    ...(reasoning !== undefined ? { reasoning_tokens: reasoning } : {}),
  };
}

// ---------------------------------------------------------------------------
// Stream accumulator
// ---------------------------------------------------------------------------

export type ResponsesTerminalStatus =
  | "completed"
  | "incomplete"
  | "failed"
  | "refused";

export interface ResponsesTerminalState {
  status: ResponsesTerminalStatus;
  /** e.g. `max_output_tokens` / `content_filter` for incomplete responses. */
  reason?: string;
  error?: { code?: string; message?: string };
  responseId?: string;
}

export type NormalizedResponsesEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "usage"; usage: ResponsesAdapterUsage }
  | { type: "terminal"; terminal: ResponsesTerminalState };

export interface CompletedFunctionCall {
  itemId: string;
  callId: string;
  name: string;
  /** Raw JSON argument string as accumulated from the wire. */
  arguments: string;
  input: Record<string, unknown>;
}

interface TextChannelState {
  raw: string;
  cleanedStreamed: string;
}

interface PendingFunctionCall {
  itemKey: string;
  itemId?: string;
  callId?: string;
  name?: string;
  args: string;
  done: boolean;
}

/**
 * Push-based accumulator over raw Responses stream events. `push` returns
 * the normalized events to forward; `finish` enforces the terminal-event
 * contract once the transport reaches EOF.
 */
export class ResponsesStreamAccumulator {
  private readonly channels = new Map<string, TextChannelState & { kind: "text" | "reasoning" }>();
  private readonly itemIndexes = new Map<number, string>();
  private readonly calls = new Map<string, PendingFunctionCall>();
  private terminalState: ResponsesTerminalState | null = null;
  private usageState: ResponsesAdapterUsage | null = null;
  private refused = false;

  push(event: ResponsesStreamEvent): NormalizedResponsesEvent[] {
    const out: NormalizedResponsesEvent[] = [];
    if (this.terminalState) return out;
    const itemId = event.item?.id ?? event.item_id;
    if (itemId && event.output_index !== undefined) this.bindItemIndex(event.output_index, itemId);
    switch (event.type) {
      case "response.output_text.delta":
        this.appendDelta("text", event.delta, out, event);
        break;
      case "response.reasoning_text.delta":
      case "response.reasoning_summary_text.delta":
        this.appendDelta("reasoning", event.delta, out, event);
        break;
      case "response.output_text.done":
        this.appendDone("text", event.text, out, event);
        break;
      case "response.reasoning_text.done":
      case "response.reasoning_summary_text.done":
        this.appendDone("reasoning", event.text, out, event);
        break;
      case "response.refusal.delta":
      case "response.refusal.done":
        this.refused = true;
        break;
      case "response.output_item.added":
        this.trackItem(event.item, event.output_index);
        break;
      case "response.output_item.done":
        this.finishItem(event.item, event.output_index);
        this.finishTextItem(event.item, event.output_index, out);
        break;
      case "response.function_call_arguments.delta":
        this.appendArguments(event);
        break;
      case "response.function_call_arguments.done":
        this.finishArguments(event);
        break;
      case "response.completed":
      case "response.incomplete":
      case "response.failed":
        this.applyTerminal(event, out);
        break;
      case "error":
        this.applyErrorEvent(event, out);
        break;
      default:
        // response.created / in_progress / content_part.* carry no deltas.
        break;
    }
    return out;
  }

  /**
   * Must be called when the transport reaches EOF. A stream that ended
   * without a terminal event is an interruption, never a silent success.
   */
  finish(): void {
    if (!this.terminalState) {
      throw new ResponsesStreamInterruptedError("eof_without_terminal");
    }
    if (this.terminalState.status === "completed") {
      for (const call of this.calls.values()) {
        if (!call.done || !call.callId || !call.name || !parseArguments(call.args)) {
          throw new Error("Responses 工具调用不完整或参数无效，已停止执行");
        }
      }
    }
  }

  get terminal(): ResponsesTerminalState | null {
    return this.terminalState;
  }

  get usage(): ResponsesAdapterUsage | null {
    return this.usageState;
  }

  get rawText(): string {
    return [...this.channels.values()].filter((state) => state.kind === "text").map((state) => state.raw).join("");
  }

  get rawReasoning(): string {
    return [...this.channels.values()].filter((state) => state.kind === "reasoning").map((state) => state.raw).join("");
  }

  /**
   * Completed function calls in arrival order. Calls whose accumulated
   * arguments are not valid JSON are excluded here and rejected by finish();
   * call identity is `call_id`, so identical
   * name/arguments under different call ids are both preserved.
   */
  get toolCalls(): CompletedFunctionCall[] {
    const completed: CompletedFunctionCall[] = [];
    for (const entry of this.calls.values()) {
      if (!entry.name || !entry.callId || !entry.done) continue;
      const input = parseArguments(entry.args);
      if (!input) continue;
      completed.push({
        itemId: entry.itemId ?? entry.itemKey,
        callId: entry.callId ?? entry.itemId ?? entry.itemKey,
        name: entry.name,
        arguments: entry.args,
        input,
      });
    }
    return completed;
  }

  private channel(kind: "text" | "reasoning", event: ResponsesStreamEvent): TextChannelState {
    const key = `${kind}:${this.callKey(event.item_id, event.output_index)}:${event.content_index ?? 0}`;
    let state = this.channels.get(key);
    if (!state) {
      state = { raw: "", cleanedStreamed: "", kind };
      this.channels.set(key, state);
    }
    return state;
  }

  private appendDelta(
    kind: "text" | "reasoning",
    delta: string | undefined,
    out: NormalizedResponsesEvent[],
    event: ResponsesStreamEvent
  ) {
    if (!delta) return;
    const state = this.channel(kind, event);
    state.raw += delta;
    this.emitCleanedSlice(kind, state, out);
  }

  private appendDone(
    kind: "text" | "reasoning",
    fullText: string | undefined,
    out: NormalizedResponsesEvent[],
    event: ResponsesStreamEvent
  ) {
    if (typeof fullText !== "string" || fullText.length === 0) return;
    const state = this.channel(kind, event);
    // A done payload only fills the pieces the deltas missed; it is never
    // appended on top of them. A divergent done payload keeps the
    // accumulated deltas as the source of truth.
    if (fullText.startsWith(state.raw)) {
      state.raw = fullText;
    } else if (state.raw.length === 0) {
      state.raw = fullText;
    }
    this.emitCleanedSlice(kind, state, out);
  }

  private emitCleanedSlice(
    kind: "text" | "reasoning",
    state: TextChannelState,
    out: NormalizedResponsesEvent[]
  ) {
    const cleaned = sanitizeModelText(state.raw);
    const slice = cleaned.slice(state.cleanedStreamed.length);
    state.cleanedStreamed = cleaned;
    if (!slice) return;
    out.push(
      kind === "text"
        ? { type: "text_delta", text: slice }
        : { type: "reasoning_delta", text: slice }
    );
  }

  private callKey(
    itemId: string | undefined,
    outputIndex: number | undefined
  ): string {
    const resolvedId = itemId ?? (outputIndex !== undefined ? this.itemIndexes.get(outputIndex) : undefined);
    if (resolvedId) return `item:${resolvedId}`;
    return `output_index:${outputIndex ?? 0}`;
  }

  private bindItemIndex(index: number, id: string) {
    const previous = this.itemIndexes.get(index);
    if (previous && previous !== id) throw new Error("Responses output_index 对应多个 item_id");
    this.itemIndexes.set(index, id);
    const oldKey = `output_index:${index}`;
    const key = `item:${id}`;
    const pending = this.calls.get(oldKey);
    if (pending && !this.calls.has(key)) {
      this.calls.delete(oldKey);
      this.calls.set(key, { ...pending, itemKey: key, itemId: id });
    }
    for (const [channelKey, value] of this.channels) {
      const renamed = channelKey.replace(`:${oldKey}:`, `:${key}:`);
      if (renamed !== channelKey && !this.channels.has(renamed)) {
        this.channels.delete(channelKey);
        this.channels.set(renamed, value);
      }
    }
  }

  private ensureCall(key: string): PendingFunctionCall {
    let entry = this.calls.get(key);
    if (!entry) {
      entry = { itemKey: key, args: "", done: false };
      this.calls.set(key, entry);
    }
    return entry;
  }

  private trackItem(item: ResponsesOutputItem | undefined, outputIndex?: number) {
    if (!item || item.type !== "function_call") return;
    const entry = this.ensureCall(this.callKey(item.id, outputIndex));
    if (item.id) entry.itemId = item.id;
    if (item.call_id) entry.callId = item.call_id;
    if (item.name) entry.name = item.name;
    if (typeof item.arguments === "string" && item.arguments.length > 0) {
      entry.args = mergeDoneArguments(entry.args, item.arguments);
    }
  }

  private finishItem(item: ResponsesOutputItem | undefined, outputIndex?: number) {
    if (!item || item.type !== "function_call") return;
    const entry = this.ensureCall(this.callKey(item.id, outputIndex));
    if (item.id) entry.itemId = item.id;
    if (item.call_id) entry.callId = item.call_id;
    if (item.name) entry.name = item.name;
    // The done item carries the full argument string; it fills gaps but is
    // never appended to the delta accumulation.
    if (typeof item.arguments === "string" && item.arguments.length > 0) {
      entry.args = mergeDoneArguments(entry.args, item.arguments);
    }
    entry.done = true;
  }

  private appendArguments(event: ResponsesStreamEvent) {
    if (!event.delta) return;
    const entry = this.ensureCall(
      this.callKey(event.item_id, event.output_index)
    );
    if (event.item_id) entry.itemId = event.item_id;
    entry.args += event.delta;
  }

  private finishArguments(event: ResponsesStreamEvent) {
    const entry = this.ensureCall(
      this.callKey(event.item_id, event.output_index)
    );
    if (event.item_id) entry.itemId = event.item_id;
    if (typeof event.arguments === "string" && event.arguments.length > 0) {
      entry.args = mergeDoneArguments(entry.args, event.arguments);
    }
    entry.done = true;
  }

  private finishTextItem(item: ResponsesOutputItem | undefined, outputIndex: number | undefined, out: NormalizedResponsesEvent[]) {
    if (!item) return;
    if (item.content?.some((part) => part.type === "refusal")) this.refused = true;
    const parts = item.type === "reasoning" ? (item.content ?? item.summary ?? []) : item.content ?? [];
    parts.forEach((part, index) => {
      if (part.type === "output_text" || part.type === "reasoning_text" || part.type === "summary_text") {
        this.appendDone(part.type === "output_text" ? "text" : "reasoning", part.text, out, {
          type: "done", item_id: item.id, output_index: outputIndex, content_index: index,
        });
      }
    });
  }

  private applyTerminal(
    event: ResponsesStreamEvent,
    out: NormalizedResponsesEvent[]
  ) {
    const response = event.response;
    response?.output?.forEach((item, index) => {
      if (item.id) this.bindItemIndex(index, item.id);
      this.finishItem(item, index);
      this.finishTextItem(item, index, out);
    });
    let status: ResponsesTerminalStatus =
      event.type === "response.completed"
        ? "completed"
        : event.type === "response.incomplete"
          ? "incomplete"
          : "failed";
    const reason = response?.incomplete_details?.reason;
    // Content-filter truncation and refusal parts are refusals, not
    // truncation or failure, so callers can render them differently.
    if (status === "incomplete" && reason === "content_filter") {
      status = "refused";
    }
    if (status === "completed" && (this.refused || (response && responseHasRefusal(response)))) {
      status = "refused";
    }
    const error = response?.error;
    this.terminalState = {
      status,
      ...(reason ? { reason } : {}),
      ...(error && (error.code || error.message)
        ? { error: { code: error.code, message: error.message } }
        : {}),
      ...(response?.id ? { responseId: response.id } : {}),
    };
    if (response?.usage) {
      this.usageState = mapResponsesUsage(response.usage);
      out.push({ type: "usage", usage: this.usageState });
    }
    out.push({ type: "terminal", terminal: this.terminalState });
  }

  private applyErrorEvent(
    event: ResponsesStreamEvent,
    out: NormalizedResponsesEvent[]
  ) {
    this.terminalState = {
      status: "failed",
      error: {
        ...(event.code ? { code: event.code } : {}),
        ...(event.message ? { message: event.message } : {}),
      },
    };
    out.push({ type: "terminal", terminal: this.terminalState });
  }
}

/**
 * Consumes a raw Responses event stream into normalized events, enforcing
 * the EOF contract: no terminal event means the stream was interrupted.
 */
export async function* normalizeResponsesStream(
  source: AsyncIterable<ResponsesStreamEvent>,
  accumulator: ResponsesStreamAccumulator = new ResponsesStreamAccumulator()
): AsyncGenerator<NormalizedResponsesEvent> {
  for await (const event of source) {
    for (const normalized of accumulator.push(event)) {
      yield normalized;
    }
    if (accumulator.terminal) break;
  }
  accumulator.finish();
}

function mergeDoneArguments(accumulated: string, done: string): string {
  if (!done) return accumulated;
  if (done.startsWith(accumulated)) return done;
  if (accumulated.length === 0) return done;
  return accumulated;
}

function parseArguments(args: string): Record<string, unknown> | null {
  if (!args) return {};
  try {
    const parsed: unknown = JSON.parse(args);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function responseHasRefusal(response: ResponsesResponsePayload): boolean {
  return (response.output ?? []).some(
    (item) =>
      item.type === "message" &&
      (item.content ?? []).some((part) => part.type === "refusal")
  );
}

// ---------------------------------------------------------------------------
// Provider request bodies
// ---------------------------------------------------------------------------

export interface BuildResponsesBodyInput {
  /** Provider wire model id (see the model catalog). */
  model: string;
  messages: DeepSeekMessage[];
  attachments?: ServerFileAttachment[];
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  tools?: ResponsesToolSpecInput[];
  toolChoice?: ResponsesToolChoice;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stream?: boolean;
}

function baseBody(input: BuildResponsesBodyInput): ResponsesRequestBody {
  const { instructions, input: items } = messagesToInputItems(
    input.messages,
    input.attachments
  );
  return {
    model: input.model,
    input: items,
    ...(instructions ? { instructions } : {}),
    ...(input.tools?.length
      ? { tools: input.tools.map(toResponsesFunctionTool) }
      : {}),
    ...(input.stream !== undefined ? { stream: input.stream } : {}),
    ...(input.maxOutputTokens !== undefined
      ? { max_output_tokens: input.maxOutputTokens }
      : {}),
  };
}

/**
 * DeepSeek Responses is stateless: `store`, `previous_response_id`, and
 * `conversation` are never sent. `web_search` stays a client-side function
 * tool (never the built-in tool type) so the platform web search cannot be
 * executed twice.
 */
export function buildDeepSeekResponsesBody(
  input: BuildResponsesBodyInput
): ResponsesRequestBody {
  const body = baseBody(input);
  body.reasoning = { effort: input.thinkingEnabled ? input.reasoningEffort : "none" };
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (input.topP !== undefined) body.top_p = input.topP;
  if (input.toolChoice) body.tool_choice = input.toolChoice;
  return body;
}

/**
 * MiniMax-M3 defaults `reasoning.effort` to `none`; enabling thinking must
 * therefore send an explicit non-none effort (any of minimal/low/medium/high
 * enables Adaptive Thinking without changing its depth). Temperature is
 * capped at the documented (0, 1] range and `tool_choice` only knows
 * `none` / `auto`.
 */
export function buildMiniMaxResponsesBody(
  input: BuildResponsesBodyInput
): ResponsesRequestBody {
  const body = baseBody(input);
  body.reasoning = {
    effort: input.thinkingEnabled
      ? mapNonNoneEffort(input.reasoningEffort)
      : "none",
  };
  if (input.temperature !== undefined) {
    body.temperature = Math.min(1, Math.max(0.01, input.temperature));
  }
  if (input.topP !== undefined) {
    body.top_p = Math.min(1, Math.max(0.01, input.topP));
  }
  if (input.toolChoice) {
    body.tool_choice =
      input.toolChoice === "none" || input.toolChoice === "auto"
        ? input.toolChoice
        : "auto";
  }
  encodeFunctionNames(body);
  return body;
}

/**
 * Qwen Bailian compatible-mode. `previous_response_id` is never sent: the
 * first migration replays local items explicitly instead of depending on
 * 7-day server-side response state. Reasoning maps onto
 * none/minimal/low/medium/high with `medium` as the default. Video/audio are explicitly rejected: this endpoint does not support them.
 */
export function buildQwenResponsesBody(
  input: BuildResponsesBodyInput
): ResponsesRequestBody {
  const body = baseBody(input);
  body.store = false;
  body.reasoning = {
    effort: input.thinkingEnabled
      ? mapNonNoneEffort(input.reasoningEffort)
      : "none",
  };
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (input.topP !== undefined) body.top_p = input.topP;
  if (input.toolChoice) {
    if (input.toolChoice === "required" && input.tools?.length !== 1) {
      throw new ResponsesSerializationError("Qwen required 工具选择仅支持一个工具");
    }
    body.tool_choice = typeof input.toolChoice === "object"
      ? { type: "allowed_tools", mode: "required", tools: [input.toolChoice] }
      : input.toolChoice;
  }
  encodeFunctionNames(body);
  // Qwen requires each function output immediately after its paired call.
  // Reorder only within a contiguous call/output group, never across user turns.
  const paired: ResponsesInputItem[] = [];
  for (let index = 0; index < body.input.length; index += 1) {
    const item = body.input[index];
    if (item.type !== "function_call") {
      if (item.type === "function_call_output") {
        throw new ResponsesSerializationError("Qwen 工具结果缺少对应调用");
      }
      paired.push(item);
      continue;
    }
    const group: ResponsesInputItem[] = [];
    while (index < body.input.length && ["function_call", "function_call_output"].includes(body.input[index].type ?? "")) {
      group.push(body.input[index++]);
    }
    index -= 1;
    const outputs = new Map<string, ResponsesFunctionCallOutputItem>();
    for (const member of group) {
      if (member.type !== "function_call_output") continue;
      if (outputs.has(member.call_id)) throw new ResponsesSerializationError("Qwen 工具结果 call_id 重复");
      outputs.set(member.call_id, member);
    }
    for (const member of group) {
      if (member.type !== "function_call") continue;
      const output = outputs.get(member.call_id);
      if (!output) throw new ResponsesSerializationError("Qwen 工具调用缺少对应结果");
      paired.push(member, output);
      outputs.delete(member.call_id);
    }
    if (outputs.size) throw new ResponsesSerializationError("Qwen 工具结果缺少对应调用");
  }
  body.input = paired;
  return body;
}

/**
 * The internal `high` is the platform default and maps to each provider's
 * documented default (`medium`); explicit `max` maps to `high`.
 */
function mapNonNoneEffort(effort: "high" | "max"): ResponsesReasoningEffort {
  return effort === "max" ? "high" : "medium";
}
