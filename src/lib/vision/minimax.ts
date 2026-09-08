import Anthropic from "@anthropic-ai/sdk";
import { cacheExperiments } from "@/lib/cache/experiment-config";
import { applyActiveCache } from "@/lib/cache/minimax-active-cache";
import { repairPdfBuffer } from "@/lib/files/pdf-integrity";

const MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";

const DOCUMENT_PROMPT = `你是大学课程资料的文档解析工具。请读取用户提供的文档并输出忠实 Markdown。

必须提取：标题层级、正文、表格、公式、代码、图表文字、题号、选项、实验数据、页码线索和注释。
只转录和整理文档内容，不解题，不补全缺失数据，不生成实验报告。
看不清或缺失的内容统一标记为 [无法识别]。
保留原始语言、数字、单位、代码缩进和表格关系。`;

/**
 * 任务 05 起本模块只保留项目 PDF 的 MiniMax 原生解析（minimax-pdf-parser 使用）。
 * 独立图片 OCR/摘要链路已删除：图片由最终多模态模型直接消费。
 */
export class MiniMaxError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "MiniMaxError";
  }
}

export function mapAnthropicErrorToMiniMaxError(
  error: InstanceType<typeof Anthropic.APIError>,
  context?: string
): MiniMaxError {
  const status = error.status ?? 502;
  const messages: Record<number, string> = {
    400: context
      ? `MiniMax ${context}请求格式无效`
      : "MiniMax 请求格式无效",
    401: "MiniMax API Key 无效，请在设置中更新",
    413: context
      ? `${context}或请求体超过 MiniMax 限制`
      : "请求体超过 MiniMax 限制",
    429: "MiniMax 请求频率过高，请稍后重试",
    500: "MiniMax 服务异常，请稍后重试",
    529: "MiniMax 服务过载，请稍后重试",
  };
  return new MiniMaxError(
    status,
    messages[status] || `MiniMax API 错误 (${status})`
  );
}

export async function parseDocumentWithMiniMax(options: {
  apiKey: string;
  data: Buffer;
  filename: string;
  mediaType: string;
}): Promise<string> {
  const client = new Anthropic({
    baseURL: MINIMAX_BASE_URL,
    apiKey: options.apiKey,
    timeout: 300_000,
    maxRetries: 0,
  });

  // MiniMax 的 document block 要求严格的 PDF 字节布局（%PDF- 文件头等），
  // 发送前先校验并修复杂质字节，损坏文件直接给出可操作错误而非模型报错。
  let data = options.data;
  if (options.mediaType === "application/pdf") {
    const repaired = repairPdfBuffer(options.data);
    if (!repaired.ok) {
      throw new MiniMaxError(
        400,
        `${options.filename || "PDF 文件"}：${repaired.reason}`
      );
    }
    data = repaired.data;
  }

  try {
    const requestBody: Anthropic.MessageCreateParamsNonStreaming = {
      model: "MiniMax-M3",
      max_tokens: 16384,
      temperature: 0.2,
      thinking: { type: "disabled" },
      system: DOCUMENT_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请解析文档 ${options.filename}，输出可直接检索和引用的 Markdown。`,
            },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: options.mediaType,
                data: data.toString("base64"),
              },
            } as never,
          ],
        },
      ],
    };
    const response = await client.messages.create(
      applyActiveCache(requestBody, cacheExperiments.minimaxActiveCache)
    );

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) throw new MiniMaxError(502, "MiniMax 未返回可用的解析内容");
    return text;
  } catch (error) {
    if (error instanceof MiniMaxError) throw error;
    if (error instanceof Anthropic.APIError) {
      throw mapAnthropicErrorToMiniMaxError(error, "文档");
    }
    throw new MiniMaxError(502, "无法连接 MiniMax API，请稍后重试");
  }
}
