import AdmZip from "adm-zip";

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

function mapMinerUError(code: string | number | undefined, message?: string) {
  const normalized = String(code ?? "");
  const messages: Record<string, string> = {
    "-60005": "文件大小超过 200MB 限制，请压缩或拆分后重试",
    "-60006": "文件页数超过 200 页限制，请拆分后重试",
    "-60018": "今日解析额度已用完（1000页/天），请明日再试",
    "-60010": "解析失败，MinerU 服务暂时不可用，请稍后重试",
    "-60009": "队列已满，请稍后重试",
    "A0202": "MinerU Token 无效",
    "A0211": "MinerU Token 已过期",
  };
  return messages[normalized] || `解析失败：${message || "未知错误"}（错误码：${normalized || "unknown"}）`;
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
    throw new MinerUError(body.code, mapMinerUError(body.code, body.msg));
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
    throw new MinerUError(body.code, mapMinerUError(body.code, body.msg));
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
        mapMinerUError(result.err_code, result.err_msg)
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new MinerUError("timeout", "MinerU 解析超时（超过10分钟），请重试");
}

export async function downloadAndExtractMarkdown(zipUrl: string): Promise<string> {
  const resp = await fetch(zipUrl);
  if (!resp.ok) {
    throw new MinerUError(resp.status, "MinerU 解析结果下载失败，请重试");
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const markdownEntry =
    entries.find((entry) => entry.entryName.endsWith("/full.md")) ||
    entries.find((entry) => entry.entryName === "full.md") ||
    entries.find((entry) => entry.entryName.toLowerCase().endsWith(".md"));

  if (!markdownEntry) {
    throw new MinerUError("missing-full-md", "MinerU 结果中未找到 Markdown 内容");
  }

  return markdownEntry.getData().toString("utf-8").trim();
}

function countMarkdownImages(content: string) {
  const markdownImages = content.match(/!\[[^\]]*]\([^)]*\)/g) || [];
  const htmlImages = content.match(/<img\b[^>]*>/gi) || [];
  return markdownImages.length + htmlImages.length;
}

export async function parseFileWithMinerU(options: {
  token: string;
  fileBuffer: Buffer;
  filename: string;
  onProgress?: (stage: string, progress?: { current: number; total: number }) => void;
}): Promise<{
  content: string;
	  metadata: {
	    parser: "mineru-pipeline" | "mineru-vlm";
	    taskId: string;
	    parsedAt: string;
	    retainedImageCount?: number;
	    requiresVisionModel?: boolean;
	  };
	}> {
  options.onProgress?.("uploading");
  const submitted = await submitFileToMinerU({
    token: options.token,
    fileBuffer: options.fileBuffer,
    filename: options.filename,
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

  const content = await downloadAndExtractMarkdown(result.fullZipUrl);
  const retainedImageCount = countMarkdownImages(content);
  return {
    content,
    metadata: {
      parser: "mineru-pipeline",
      taskId: submitted.taskId,
      parsedAt: new Date().toISOString(),
      ...(retainedImageCount > 0
        ? {
            retainedImageCount,
            requiresVisionModel: true,
          }
        : {}),
    },
  };
}
