import {
  buildSystemPrompt,
  buildUserText,
  parseAnalysisResponse,
  type ImageAnalysisMode,
  type ImageAnalysisResult,
  type MiniMaxImageMedia,
} from "./minimax-analyzer";

export const QWEN_VL_MODEL = "qwen3.7-plus";

/** 百炼 DashScope OpenAI 兼容端点（chat completions），与 embedding.ts 同一域名风格 */
export const DASHSCOPE_OPENAI_ENDPOINT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export class QwenError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "QwenError";
  }
}

export interface AnalyzeImageWithQwenOptions {
  apiKey: string;
  image:
    | { type: "url"; url: string }
    | { type: "base64"; mediaType: MiniMaxImageMedia; data: Buffer };
  mode?: ImageAnalysisMode;
  context?: string;
  pageLabel?: string;
}

interface QwenChatCompletion {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  message?: string;
}

function mapQwenError(status: number, payload: QwenChatCompletion | null): QwenError {
  const messages: Record<number, string> = {
    400: "Qwen 图片请求格式无效",
    401: "百炼 API Key 无效，请在设置中更新",
    403: "当前百炼凭据无权访问 Qwen3.7-Plus",
    413: "图片或请求体超过 Qwen 限制",
    429: "Qwen 请求频率过高，请稍后重试",
    500: "Qwen 服务异常，请稍后重试",
    503: "Qwen 服务繁忙，请稍后重试",
  };
  return new QwenError(
    status,
    messages[status] || payload?.message || `Qwen API 错误 (${status})`
  );
}

function extractText(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && (part.type === "text" || part.type === undefined))
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }
  return "";
}

export async function analyzeImageWithQwen(
  options: AnalyzeImageWithQwenOptions
): Promise<ImageAnalysisResult> {
  const mode = options.mode || "general";
  const imageUrl =
    options.image.type === "url"
      ? options.image.url
      : `data:${options.image.mediaType};base64,${options.image.data.toString("base64")}`;

  let response: Response;
  try {
    response = await fetch(
      process.env.DASHSCOPE_VL_ENDPOINT?.trim() || DASHSCOPE_OPENAI_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: QWEN_VL_MODEL,
          max_tokens: 4096,
          temperature: 0.2,
          messages: [
            { role: "system", content: buildSystemPrompt(mode) },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: buildUserText(mode, options.context, options.pageLabel),
                },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );
  } catch {
    throw new QwenError(502, "无法连接百炼 Qwen API，请稍后重试");
  }

  const payload = (await response.json().catch(() => null)) as QwenChatCompletion | null;
  if (!response.ok) {
    throw mapQwenError(response.status, payload);
  }

  const text = extractText(payload?.choices?.[0]?.message?.content);
  if (!text) {
    throw new QwenError(502, "Qwen 未返回可用的解析内容");
  }

  const result = parseAnalysisResponse(text);
  const usage = payload?.usage;
  if (usage && typeof usage.prompt_tokens === "number") {
    result.usage = {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens ?? 0,
      totalTokens:
        usage.total_tokens ?? usage.prompt_tokens + (usage.completion_tokens ?? 0),
    };
  }
  return result;
}
