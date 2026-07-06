import { describe, it, expect, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  analyzeImageWithMiniMax,
  selectImageDetail,
  selectImageThinking,
} from "../vision/minimax-analyzer";
import { MiniMaxError } from "@/lib/vision/minimax";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const MockedAnthropic = vi.fn(function () {
    return { messages: { create: createMock } };
  }) as unknown as typeof actual.default;
  Object.assign(MockedAnthropic, actual.default);
  MockedAnthropic.APIError = actual.APIError;
  return {
    ...actual,
    default: MockedAnthropic,
  };
});

function mockCreate(response: unknown) {
  createMock.mockReset();
  createMock.mockResolvedValue(response);
  return createMock;
}

describe("analyzeImageWithMiniMax", () => {
  it("constructs URL source request", async () => {
    mockCreate({
      content: [
        {
          type: "text",
          text: '{"summary":"ok","ocrText":"hi","confidence":0.8,"warnings":[]}',
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const result = await analyzeImageWithMiniMax({
      apiKey: "sk-test",
      image: { type: "url", url: "https://example.com/img.png" },
      mode: "general",
      detail: "default",
      thinking: "disabled",
    });

    const request = createMock.mock.calls[0][0];
    expect(request.model).toBe("MiniMax-M3");
    expect(request.max_tokens).toBe(4096);
    expect(request.temperature).toBe(0.2);
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.messages[0].content[1]).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/img.png", detail: "default" },
    });
    expect(result.summary).toBe("ok");
    expect(result.ocrText).toBe("hi");
    expect(result.confidence).toBe(0.8);
    expect(result.warnings).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  });

  it("constructs base64 source request", async () => {
    mockCreate({
      content: [
        {
          type: "text",
          text: '{"summary":"base64-ok","ocrText":"42","confidence":0.9,"warnings":["small"]}',
        },
      ],
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const buffer = Buffer.from("fake-image-data");
    await analyzeImageWithMiniMax({
      apiKey: "sk-test",
      image: { type: "base64", mediaType: "image/png", data: buffer },
      mode: "code",
      context: "page 7",
    });

    const request = createMock.mock.calls[0][0];
    expect(request.messages[0].content[1]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: buffer.toString("base64"),
        detail: "high",
      },
    });
    expect(request.messages[0].content[0].text).toContain("page 7");
    expect(request.messages[0].content[0].text).toContain("code");
  });

  it("selects detail by mode", () => {
    expect(selectImageDetail("code", undefined)).toBe("high");
    expect(selectImageDetail("ocr", undefined)).toBe("low");
    expect(selectImageDetail("general", undefined)).toBe("default");
    expect(selectImageDetail("chart", undefined)).toBe("default");
    expect(selectImageDetail("ocr", "low")).toBe("low");
    expect(selectImageDetail("general", "high")).toBe("high");
  });

  it("selects thinking by mode", () => {
    expect(selectImageThinking("diagram", undefined)).toBe("adaptive");
    expect(selectImageThinking("chart", undefined)).toBe("adaptive");
    expect(selectImageThinking("general", undefined)).toBe("disabled");
    expect(selectImageThinking("ocr", undefined)).toBe("disabled");
    expect(selectImageThinking("general", "adaptive")).toBe("adaptive");
  });

  it("extracts usage from response", async () => {
    mockCreate({
      content: [
        {
          type: "text",
          text: '{"summary":"u","ocrText":"v","confidence":1,"warnings":[]}',
        },
      ],
      usage: { input_tokens: 123, output_tokens: 456 },
    });

    const result = await analyzeImageWithMiniMax({
      apiKey: "sk-test",
      image: { type: "url", url: "https://example.com/img.png" },
    });

    expect(result.usage).toEqual({
      inputTokens: 123,
      outputTokens: 456,
      totalTokens: 579,
    });
  });

  it("maps APIError status codes to MiniMaxError", async () => {
    createMock.mockReset();
    createMock.mockRejectedValue(
      new Anthropic.APIError(401, { message: "Unauthorized" }, "Unauthorized", undefined)
    );

    await expect(
      analyzeImageWithMiniMax({
        apiKey: "sk-test",
        image: { type: "url", url: "https://example.com/img.png" },
      })
    ).rejects.toThrow(MiniMaxError);

    try {
      await analyzeImageWithMiniMax({
        apiKey: "sk-test",
        image: { type: "url", url: "https://example.com/img.png" },
      });
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MiniMaxError);
      expect((error as MiniMaxError).status).toBe(401);
      expect((error as MiniMaxError).message).toContain("API Key");
    }
  });

  it("maps unknown errors to 502", async () => {
    createMock.mockReset();
    createMock.mockRejectedValue(new Error("network failure"));

    await expect(
      analyzeImageWithMiniMax({
        apiKey: "sk-test",
        image: { type: "url", url: "https://example.com/img.png" },
      })
    ).rejects.toThrow(MiniMaxError);

    try {
      await analyzeImageWithMiniMax({
        apiKey: "sk-test",
        image: { type: "url", url: "https://example.com/img.png" },
      });
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MiniMaxError);
      expect((error as MiniMaxError).status).toBe(502);
    }
  });
});
