// @vitest-environment node

import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFileWithMinerU } from "@/lib/parse/mineru";
import { MINERU_GENERIC_ERROR_MESSAGE } from "@/lib/parse/mineru-errors";

function makeResultZip() {
  const zip = new AdmZip();
  zip.addFile("result/full.md", Buffer.from("# 题目\n\n![电路](images/circuit.png)"));
  zip.addFile("result/images/circuit.png", Buffer.from([1, 2, 3]));
  return zip.toBuffer();
}

function stubSuccessfulMinerUFlow(options?: {
  onSubmitBody?: (body: Record<string, unknown>) => void;
}) {
  const zipBuffer = makeResultZip();
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v4/file-urls/batch")) {
      options?.onSubmitBody?.(JSON.parse(String(init?.body)));
      return Response.json({
        code: 0,
        data: {
          batch_id: "batch-1",
          file_urls: ["https://upload.example/file"],
        },
      });
    }
    if (url === "https://upload.example/file") {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/api/v4/extract-results/batch/batch-1")) {
      return Response.json({
        code: 0,
        data: {
          extract_result: [
            {
              state: "done",
              full_zip_url: "https://download.example/result.zip",
            },
          ],
        },
      });
    }
    if (url === "https://download.example/result.zip") {
      return new Response(new Uint8Array(zipBuffer), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFailedMinerUTask(result: {
  err_code?: string;
  err_msg?: string;
}) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/v4/file-urls/batch")) {
      return Response.json({
        code: 0,
        data: {
          batch_id: "batch-1",
          file_urls: ["https://upload.example/file"],
        },
      });
    }
    if (url === "https://upload.example/file") {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/api/v4/extract-results/batch/batch-1")) {
      return Response.json({
        code: 0,
        data: {
          extract_result: [{ state: "failed", ...result }],
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("parseFileWithMinerU", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns normalized referenced image assets from the MinerU ZIP", async () => {
    stubSuccessfulMinerUFlow();

    const result = await parseFileWithMinerU({
      token: "token",
      fileBuffer: Buffer.from("pdf"),
      filename: "circuit.pdf",
    });

    expect(result.content).toContain("![电路](pics/circuit.png)");
    expect(result.assets).toEqual([
      {
        relativePath: "pics/circuit.png",
        mimeType: "image/png",
        buffer: Buffer.from([1, 2, 3]),
      },
    ]);
    expect(result.metadata.retainedImageCount).toBe(1);
  });

  it("submits with vlm model_version by default and reports mineru-vlm metadata", async () => {
    let submitBody: Record<string, unknown> | undefined;
    stubSuccessfulMinerUFlow({
      onSubmitBody: (body) => {
        submitBody = body;
      },
    });

    const result = await parseFileWithMinerU({
      token: "token",
      fileBuffer: Buffer.from("pdf"),
      filename: "circuit.pdf",
    });

    expect(submitBody).toMatchObject({ model_version: "vlm" });
    expect(result.metadata.parser).toBe("mineru-vlm");
  });

  it("keeps pipeline model_version when explicitly requested", async () => {
    let submitBody: Record<string, unknown> | undefined;
    stubSuccessfulMinerUFlow({
      onSubmitBody: (body) => {
        submitBody = body;
      },
    });

    const result = await parseFileWithMinerU({
      token: "token",
      fileBuffer: Buffer.from("pdf"),
      filename: "circuit.pdf",
      modelVersion: "pipeline",
    });

    expect(submitBody).toMatchObject({ model_version: "pipeline" });
    expect(result.metadata.parser).toBe("mineru-pipeline");
  });

  it("maps known MinerU err_code to a Chinese message and keeps the code on MinerUError", async () => {
    stubFailedMinerUTask({ err_code: "-60009", err_msg: "task queue is full" });

    const error = await parseFileWithMinerU({
      token: "token",
      fileBuffer: Buffer.from("pdf"),
      filename: "circuit.pdf",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("MinerUError");
    expect((error as Error).message).toBe("队列已满，请稍后重试");
    expect((error as { code?: unknown }).code).toBe("-60009");
  });

  it("never passes the English err_msg through for unknown or empty err_code", async () => {
    stubFailedMinerUTask({
      err_code: "-69999",
      err_msg: "model inference failed: out of memory",
    });

    const unknownCode = await parseFileWithMinerU({
      token: "token",
      fileBuffer: Buffer.from("pdf"),
      filename: "circuit.pdf",
    }).catch((caught: unknown) => caught);
    expect((unknownCode as Error).message).toBe(MINERU_GENERIC_ERROR_MESSAGE);
    expect((unknownCode as Error).message).not.toContain("out of memory");

    stubFailedMinerUTask({ err_msg: "model inference failed" });
    const emptyCode = await parseFileWithMinerU({
      token: "token",
      fileBuffer: Buffer.from("pdf"),
      filename: "circuit.pdf",
    }).catch((caught: unknown) => caught);
    expect((emptyCode as Error).message).toBe(MINERU_GENERIC_ERROR_MESSAGE);
    expect((emptyCode as Error).message).not.toContain("unknown");
  });
});

