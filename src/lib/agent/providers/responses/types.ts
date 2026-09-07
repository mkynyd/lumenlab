/**
 * Provider-neutral wire types for the OpenAI-compatible Responses API shared
 * by DeepSeek (`https://api.deepseek.com`), MiniMax (`https://api.minimax.cn/v1`),
 * and Qwen Bailian compatible-mode (`.../compatible-mode/v1`).
 *
 * Only the subset all three providers actually support is modeled. Stateful
 * capabilities (`previous_response_id`, `conversation`, built-in
 * tools such as `web_search` / `code_interpreter`) are intentionally absent:
 * DeepSeek is stateless, MiniMax offers no state, and Qwen's
 * `previous_response_id` is not relied on for task reliability (state is
 * replayed explicitly from platform-side items). Qwen alone sends `store: false`.
 */

export type ResponsesMessageRole = "user" | "assistant" | "system" | "developer";

export interface ResponsesInputTextPart {
  type: "input_text";
  text: string;
}

export interface ResponsesOutputTextPart {
  type: "output_text";
  text: string;
}

export interface ResponsesInputImagePart {
  type: "input_image";
  /** http(s) URL or base64 data URL (`data:image/jpeg;base64,...`). */
  image_url: string;
  detail?: "low" | "high" | "auto" | "original";
}

export type ResponsesInputContentPart =
  | ResponsesInputTextPart
  | ResponsesOutputTextPart
  | ResponsesInputImagePart;

export interface ResponsesMessageItem {
  type?: "message";
  role: ResponsesMessageRole;
  content: string | ResponsesInputContentPart[];
}

export interface ResponsesFunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  /** JSON-encoded argument string, as on the wire. */
  arguments: string;
}

/** MiniMax and DeepSeek both accept a plain string or a content-part array. */
export type ResponsesFunctionCallOutput = string | ResponsesInputContentPart[];

export interface ResponsesFunctionCallOutputItem {
  type: "function_call_output";
  call_id: string;
  output: ResponsesFunctionCallOutput;
}

export interface ResponsesReasoningItem {
  type: "reasoning";
  content?: Array<{ type: "reasoning_text"; text: string }>;
  summary?: Array<{ type: "summary_text"; text: string }>;
}

export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem
  | ResponsesReasoningItem;

/**
 * `max` is DeepSeek's top effort level; MiniMax accepts
 * minimal/low/medium/high (any non-`none` value enables Adaptive Thinking)
 * and Qwen accepts none/minimal/low/medium/high with `medium` as default.
 * Provider serializers are responsible for mapping onto supported values.
 */
export type ResponsesReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "max";

export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  /** JSON Schema, mapped from the internal `input_schema`. */
  parameters: Record<string, unknown>;
}

export type ResponsesToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; name: string };

export interface ResponsesAllowedToolsChoice {
  type: "allowed_tools";
  mode: "auto" | "required";
  tools: Array<{ type: "function"; name: string }>;
}

/**
 * Common request body. Optional fields are emitted only when the provider
 * serializer supports them; `previous_response_id`, `conversation`,
 * and `metadata` deliberately do not exist here.
 */
export interface ResponsesRequestBody {
  model: string;
  input: ResponsesInputItem[];
  instructions?: string;
  tools?: ResponsesFunctionTool[];
  tool_choice?: ResponsesToolChoice | ResponsesAllowedToolsChoice;
  reasoning?: { effort: ResponsesReasoningEffort };
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  stream?: boolean;
  /** Qwen only; omitted for stateless DeepSeek and MiniMax. */
  store?: false;
}

export interface ResponsesUsage {
  input_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens: number;
  output_tokens_details?: { reasoning_tokens?: number };
  total_tokens?: number;
}

export interface ResponsesResponseError {
  code?: string;
  message?: string;
}

/**
 * Output items and content parts keep an open shape: providers add fields
 * (annotations, logprobs, refusal parts) that this contract reads but never
 * round-trips verbatim.
 */
export interface ResponsesOutputContentPart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface ResponsesOutputItem {
  id?: string;
  type?: string;
  status?: string;
  role?: string;
  content?: ResponsesOutputContentPart[];
  summary?: Array<{ type?: string; text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
}

export type ResponsesResponseStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "incomplete"
  | "failed";

export interface ResponsesResponsePayload {
  id?: string;
  object?: string;
  status?: ResponsesResponseStatus | string;
  model?: string;
  output?: ResponsesOutputItem[];
  output_text?: string | null;
  usage?: ResponsesUsage;
  error?: ResponsesResponseError | null;
  incomplete_details?: { reason?: string } | null;
}

/**
 * Flat SSE event envelope. Every field except `type` is optional because the
 * three providers populate different subsets; consumers narrow by `type`.
 * Known `type` values:
 * - lifecycle: `response.created`, `response.in_progress`
 * - items: `response.output_item.added`, `response.output_item.done`,
 *   `response.content_part.added`, `response.content_part.done`
 * - text: `response.output_text.delta` / `response.output_text.done`
 * - reasoning: `response.reasoning_text.delta|done` (DeepSeek),
 *   `response.reasoning_summary_text.delta|done` (OpenAI/Qwen summaries)
 * - tools: `response.function_call_arguments.delta|done`
 * - terminal: `response.completed`, `response.incomplete`, `response.failed`,
 *   `error`
 * There is no `data: [DONE]` sentinel; the stream ends after a terminal event.
 */
export interface ResponsesStreamEvent {
  type: string;
  sequence_number?: number;
  output_index?: number;
  content_index?: number;
  item_id?: string;
  delta?: string;
  text?: string;
  arguments?: string;
  item?: ResponsesOutputItem;
  part?: ResponsesOutputContentPart;
  response?: ResponsesResponsePayload;
  code?: string | null;
  message?: string;
}
