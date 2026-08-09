import { getMinerUErrorMessage } from "@/lib/parse/mineru-errors";
import {
  extractMinerUResult,
  type ParsedImageAsset,
} from "@/lib/parse/mineru-result";

const MINERU_BASE_URL = "https://mineru.net";

type MinerUState = "done" | "pending" | "running" | "failed" | "converting";

type MinerUProgress = {
  extractedPages: number;
  totalPages: number;
};

export class MinerUError extends Error {
  constructor(public code: string | number, message: string) {
    super(message);
    this.name = "MinerUError";
  }
}

function mapMinerUError(code: string | number | undefined) {
  return getMinerUErrorMessage(code);
}

async function readJson<T>(resp: Response): Promise<T> {
  const body = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new MinerUError(resp.status, `MinerU 请求失败：${resp.status}`);
  }
  return body as T;
}

export async function submitFileToMinerU(options: {
  token: string;
  fileBuffer: Buffer;
  filename: string;
  modelVersion?: "pipeline" | "vlm";
  isOcr?: boolean;
  enableFormula?: boolean;
  enableTable?: boolean;
  language?: string;
}): Promise<{ taskId: string }> {
  const resp = await fetch(`${MINERU_BASE_URL}/api/v4/file-urls/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: [
        {
          name: options.filename,
          is_ocr: options.isOcr ?? false,
        },
      ],
      enable_formula: options.enableFormula ?? true,
      enable_table: options.enableTable ?? true,
      language: options.language || "ch",
      model_version: options.modelVersion || "pipeline",
    }),
  });

  const body = await readJson<{
    code: number | string;
    msg?: string;
    data?: {
      batch_id?: string;
      file_urls?: string[];
    };
  }>(resp);

  if (body.code !== 0 || !body.data?.batch_id || !body.data.file_urls?.[0]) {
    throw new MinerUError(body.code, mapMinerUError(body.code));
  }

  const uploadUrl = body.data.file_urls[0];
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    body: new Uint8Array(options.fileBuffer),
  });
  if (!uploadResp.ok) {
    throw new MinerUError(uploadResp.status, "文件上传到 MinerU 失败，请稍后重试");
  }

  return { taskId: body.data.batch_id };
}

async function getBatchResult(token: string, taskId: string) {
  const resp = await fetch(
    `${MINERU_BASE_URL}/api/v4/extract-results/batch/${taskId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const body = await readJson<{
    code: number | string;
    msg?: string;
    data?: {
      extract_result?: Array<{
        state: MinerUState;
        full_zip_url?: string;
        err_code?: string;
        err_msg?: string;
        extract_progress?: {
          extracted_pages?: number;
          total_pages?: number;
        };
      }>;
      extract_results?: Array<{
        state: MinerUState;
        full_zip_url?: string;
        err_code?: string;
        err_msg?: string;
        extract_progress?: {
          extracted_pages?: number;
          total_pages?: number;
        };
      }>;
    };
  }>(resp);

  if (body.code !== 0) {
    throw new MinerUError(body.code, mapMinerUError(body.code));
  }
  return (body.data?.extract_result || body.data?.extract_results || [])[0];
}

export async function pollMinerUTask(options: {
  token: string;
  taskId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onProgress?: (state: MinerUState, progress?: MinerUProgress) => void;
}): Promise<{
  state: MinerUState;
  fullZipUrl?: string;
  progress?: MinerUProgress;
  errMsg?: string;
}> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await getBatchResult(options.token, options.taskId);
    if (!result) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    const progress = result.extract_progress
      ? {
          extractedPages: result.extract_progress.extracted_pages || 0,
          totalPages: result.extract_progress.total_pages || 0,
        }
      : undefined;
    options.onProgress?.(result.state, progress);

    if (result.state === "done") {
      return {
        state: "done",
        fullZipUrl: result.full_zip_url,
        progress,
      };
    }
    if (result.state === "failed") {
      throw new MinerUError(
        result.err_code || "failed",
        mapMinerUError(result.err_code)
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new MinerUError("timeout", "MinerU 解析超时（超过10分钟），请重试");
}

// ============================================================
// 图片过滤 — 过滤 MinerU 输出中的水印/小图标，避免误触发视觉模型锁定
// ============================================================

/** 图片文件小于此值（字节）视为水印/图标/装饰元素，不触发视觉模型需求 */
const MIN_MEANINGFUL_IMAGE_BYTES = 10240; // 10 KB

/** zip 中有效图片数量达到此阈值才标记 requiresVisionModel */
const MEANINGFUL_IMAGE_COUNT_THRESHOLD = 3;

interface MarkdownResult {
  content: string;
  assets: ParsedImageAsset[];
  meaningfulImageCount: number;
}

/** 下载 MinerU 结果 zip，提取 markdown 内容 + 统计有效图片数 */
async function downloadAndExtractResult(zipUrl: string): Promise<MarkdownResult> {
  const resp = await fetch(zipUrl);
  if (!resp.ok) {
    throw new MinerUError(resp.status, "MinerU 解析结果下载失败，请重试");
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  try {
    const parsed = extractMinerUResult(buffer);
    return {
      ...parsed,
      meaningfulImageCount: parsed.assets.filter(
        (asset) => asset.buffer.length >= MIN_MEANINGFUL_IMAGE_BYTES
      ).length,
    };
  } catch (error) {
    throw new MinerUError(
      "invalid-result-zip",
      error instanceof Error ? error.message : "MinerU 结果解析失败"
    );
  }
}

export async function parseFileWithMinerU(options: {
  token: string;
  fileBuffer: Buffer;
  filename: string;
  /** MinerU 解析模型，默认 vlm（/tools 转换链路）；项目文件管线显式传 pipeline */
  modelVersion?: "pipeline" | "vlm";
  onProgress?: (stage: string, progress?: { current: number; total: number }) => void;
}): Promise<{
  content: string;
  assets: ParsedImageAsset[];
  metadata: {
    parser: "mineru-pipeline" | "mineru-vlm";
    taskId: string;
    parsedAt: string;
    retainedImageCount?: number;
    meaningfulImageCount?: number;
    requiresVisionModel?: boolean;
  };
}> {
  const modelVersion = options.modelVersion ?? "vlm";
  options.onProgress?.("uploading");
  const submitted = await submitFileToMinerU({
    token: options.token,
    fileBuffer: options.fileBuffer,
    filename: options.filename,
    modelVersion,
  });

  options.onProgress?.("pending");
  const result = await pollMinerUTask({
    token: options.token,
    taskId: submitted.taskId,
    onProgress: (state, progress) => {
      const stage = state === "running" ? "model" : state;
      options.onProgress?.(
        stage,
        progress
          ? { current: progress.extractedPages, total: progress.totalPages }
          : undefined
      );
    },
  });

  if (!result.fullZipUrl) {
    throw new MinerUError("missing-zip-url", "MinerU 未返回解析结果下载地址");
  }

  const { content, assets, meaningfulImageCount } = await downloadAndExtractResult(
    result.fullZipUrl
  );
  const retainedImageCount = assets.length;
  const requiresVisionModel =
    meaningfulImageCount >= MEANINGFUL_IMAGE_COUNT_THRESHOLD;

  return {
    content,
    assets,
    metadata: {
      parser: modelVersion === "vlm" ? "mineru-vlm" : "mineru-pipeline",
      taskId: submitted.taskId,
      parsedAt: new Date().toISOString(),
      ...(retainedImageCount > 0
        ? {
            retainedImageCount,
            meaningfulImageCount,
            ...(requiresVisionModel ? { requiresVisionModel: true } : {}),
          }
        : {}),
    },
  };
}
