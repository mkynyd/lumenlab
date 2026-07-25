// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  analyzeImageWithQwen,
  QwenError,
  DASHSCOPE_OPENAI_ENDPOINT,
} from "../vision/qwen-analyzer";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: "sk-bailian",
    image: {
      type: "base64" as const,
      mediaType: "image/png" as const,
      data: Buffer.from("fake-image-bytes"),
    },
    mode: "chart" as const,
    ...overrides,
  };
}

describe("analyzeImageWithQwen", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an OpenAI-compatible chat completions request with a data URL image", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '{"summary":"s","ocrText":"t","confidence":0.9}' } }],
      })
    );

    await analyzeImageWithQwen(makeOptions());

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(DASHSCOPE_OPENAI_ENDPOINT);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-bailian");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen3.7-plus");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("视觉转录工具");
    expect(body.messages[1].role).toBe("user");
    const parts = body.messages[1].content;
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toContain("解析模式：chart");
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url.url).toBe(
      `data:image/png;base64,${Buffer.from("fake-image-bytes").toString("base64")}`
    );
  });

  it("maps a JSON response into the analysis result with usage", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"summary":"柱状图","ocrText":"Q1 100","confidence":1.4,"warnings":["模糊"]}',
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      })
    );

    const result = await analyzeImageWithQwen(makeOptions());

    expect(result.summary).toBe("柱状图");
    expect(result.ocrText).toBe("Q1 100");
    expect(result.confidence).toBe(1); // clamped to 0-1
    expect(result.warnings).toEqual(["模糊"]);
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("joins array-form message content parts", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: '{"summary":"a",' },
                { type: "text", text: '"ocrText":"b","confidence":0.5}' },
              ],
            },
          },
        ],
      })
    );

    const result = await analyzeImageWithQwen(makeOptions());
    expect(result.summary).toBe("a");
    expect(result.ocrText).toBe("b");
  });

  it("falls back to plain text when the model does not return JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "not json at all" } }],
      })
    );

    const result = await analyzeImageWithQwen(makeOptions());
    expect(result.summary).toBe("not json at all");
    expect(result.confidence).toBe(0.5);
    expect(result.warnings).toContain("模型未返回 JSON，已按纯文本处理");
  });

  it("passes url images through without base64 encoding", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '{"summary":"s","ocrText":"","confidence":0.5}' } }],
      })
    );

    await analyzeImageWithQwen(
      makeOptions({ image: { type: "url", url: "https://example.com/a.png" } })
    );

    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[1].content[1].image_url.url).toBe("https://example.com/a.png");
  });

  it("maps 401 responses to a key error", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: "Invalid API-key" }, 401));

    const error = await analyzeImageWithQwen(makeOptions()).catch((e) => e);
    expect(error).toBeInstanceOf(QwenError);
    expect((error as QwenError).status).toBe(401);
    expect((error as QwenError).message).toContain("百炼 API Key 无效");
  });

  it("maps 413 responses to a size error", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, 413));

    const error = await analyzeImageWithQwen(makeOptions()).catch((e) => e);
    expect((error as QwenError).status).toBe(413);
    expect((error as QwenError).message).toContain("超过 Qwen 限制");
  });

  it("throws a 502 error when the network fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));

    const error = await analyzeImageWithQwen(makeOptions()).catch((e) => e);
    expect(error).toBeInstanceOf(QwenError);
    expect((error as QwenError).status).toBe(502);
    expect((error as QwenError).message).toContain("无法连接百炼 Qwen API");
  });

  it("throws when the response has no usable content", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "" } }] })
    );

    await expect(analyzeImageWithQwen(makeOptions())).rejects.toThrow(
      "Qwen 未返回可用的解析内容"
    );
  });
});
