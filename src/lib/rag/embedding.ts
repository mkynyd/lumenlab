import { prisma } from "@/lib/db";
import crypto from "crypto";
import {
  getQueryEmbeddingCache,
  setQueryEmbeddingCache,
} from "@/lib/cache/rag-query-embed-cache";

export const EMBEDDING_MODEL = "qwen3-vl-embedding";
export const EMBEDDING_DIM = 1024;
const BATCH_SIZE = 10;
const CHUNK_EMBED_CONCURRENCY = 5;
const MAX_MEDIA_PER_FUSION = 5; // qwen3-vl-embedding limit per fusion request
export const EMBEDDING_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding";

interface EmbeddingResult {
  status_code: number;
  code?: string;
  message?: string;
  output?: {
    embeddings?: Array<{
      text_index?: number;
      embedding: number[];
    }>;
  };
}

interface EmbeddingApi {
  createMultiModalEmbedding(options: {
    model: string;
    input: { text?: string; image?: string; video?: string }[];
    enable_fusion: boolean;
    dimension: number;
  }): Promise<EmbeddingResult>;
}

function getApi(apiKey: string) {
  return {
    async createMultiModalEmbedding(options): Promise<EmbeddingResult> {
      const { model, input, ...parameters } = options;
      const response = await fetch(
        process.env.DASHSCOPE_EMBEDDING_ENDPOINT?.trim() || EMBEDDING_ENDPOINT,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            input: { contents: input },
            parameters,
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );
      const payload = (await response.json()) as Omit<EmbeddingResult, "status_code"> & {
        status_code?: number;
      };
      return { ...payload, status_code: payload.status_code ?? response.status };
    },
  } satisfies EmbeddingApi;
}

function normalizeEmbeddingInput(items: { text?: string; image?: string; video?: string }[]) {
  return items.map((item) => {
    if (item.video) return { video: item.video };
    if (item.image) return { image: item.image };
    return { text: item.text ?? "" };
  });
}

function isCloudReachableMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function cloudReachableMediaUrls(urls: string[]): string[] {
  return (urls ?? []).filter(isCloudReachableMediaUrl).slice(0, MAX_MEDIA_PER_FUSION);
}

interface EmbeddingCallOptions {
  enableFusion?: boolean;
  expectCount?: number;
  context?: string;
}

async function callMultiModalEmbedding(
  api: EmbeddingApi,
  input: { text?: string; image?: string; video?: string }[],
  options: EmbeddingCallOptions = {}
): Promise<number[][]> {
  const { enableFusion = false, expectCount = input.length, context } = options;

  const result = await api.createMultiModalEmbedding({
    model: EMBEDDING_MODEL,
    input: normalizeEmbeddingInput(input),
    enable_fusion: enableFusion,
    dimension: EMBEDDING_DIM,
  });

  const prefix = context ? `${context}: ` : "";

  if (result.status_code !== 200 || !result.output?.embeddings) {
    throw new Error(
      `${prefix}Embedding failed: ${result.code ?? "unknown"} ${result.message ?? ""}`.trim()
    );
  }

  const embeddings = result.output.embeddings
    .slice()
    .sort((a, b) => (a.text_index ?? 0) - (b.text_index ?? 0))
    .map((item) => item.embedding);

  if (embeddings.length !== expectCount) {
    throw new Error(
      `${prefix}Embedding count mismatch: expected ${expectCount}, got ${embeddings.length}`
    );
  }

  for (const embedding of embeddings) {
    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `${prefix}Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${embedding.length}`
      );
    }
  }

  return embeddings;
}

export async function embedTexts(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];
  const api = getApi(apiKey);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await callMultiModalEmbedding(
      api,
      batch.map((text) => ({ text })),
      { expectCount: batch.length, context: `batch ${i / BATCH_SIZE + 1}` }
    );
    results.push(...embeddings);
  }

  return results;
}

export async function embedQuery(query: string, apiKey: string): Promise<number[]> {
  const cached = await getQueryEmbeddingCache(query);
  if (cached) return cached;

  const embeddings = await embedTexts([query], apiKey);
  const result = embeddings[0];
  await setQueryEmbeddingCache(query, result);
  return result;
}

export async function embedChunkWithFallback(options: {
  chunk: { id: string; content: string; mediaUrls: string[] };
  api: EmbeddingApi;
}): Promise<number[]> {
  const { chunk, api } = options;
  const mediaUrls = cloudReachableMediaUrls(chunk.mediaUrls);
  const multimediaInput: { text?: string; image?: string; video?: string }[] = [
    { text: chunk.content },
  ];
  for (const url of mediaUrls) {
    if (/\.(mp4|mov|avi|webm|mkv|flv|mpeg|mpg)(\?.*)?$/i.test(url)) {
      multimediaInput.push({ video: url });
    } else {
      multimediaInput.push({ image: url });
    }
  }

  if (mediaUrls.length === 0) {
    const embeddings = await callMultiModalEmbedding(api, [{ text: chunk.content }], {
      enableFusion: false,
      expectCount: 1,
      context: `chunk ${chunk.id} text`,
    });
    return embeddings[0];
  }

  try {
    const embeddings = await callMultiModalEmbedding(api, multimediaInput, {
      enableFusion: true,
      expectCount: 1,
      context: `chunk ${chunk.id}`,
    });
    return embeddings[0];
  } catch (error) {
    console.warn(
      `Multimodal embedding failed for chunk ${chunk.id}, falling back to text-only`,
      error
    );
    const embeddings = await callMultiModalEmbedding(api, [{ text: chunk.content }], {
      enableFusion: false,
      expectCount: 1,
      context: `chunk ${chunk.id} text fallback`,
    });
    return embeddings[0];
  }
}

export async function embedChunksForFile(options: {
  fileAssetId: string;
  apiKey: string;
}): Promise<void> {
  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: options.fileAssetId },
    select: { textContent: true },
  });
  if (!fileAsset?.textContent) return;

  const newHash = crypto
    .createHash("sha256")
    .update(fileAsset.textContent)
    .digest("hex")
    .slice(0, 32);

  const existingChunks =
    await prisma.$queryRawUnsafe<
      { id: string; contentHash: string | null; content: string; mediaUrls: string[]; embedding: unknown }[]
    >(
      `SELECT id, "contentHash", content, "mediaUrls", embedding FROM "DocumentChunk" WHERE "fileAssetId" = $1 ORDER BY "chunkIndex" ASC`,
      options.fileAssetId
    );

  if (
    existingChunks.length > 0 &&
    existingChunks.every((c) => c.contentHash === newHash && c.embedding !== null)
  ) {
    return; // Content unchanged and already embedded
  }

  if (existingChunks.length === 0) return;

  const api = getApi(options.apiKey);

  async function persistEmbedding(chunkId: string, embedding: number[]) {
    const vector = `[${embedding.join(",")}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET embedding = $1::vector WHERE id = $2`,
      vector,
      chunkId
    );
  }

  const textOnlyChunks = existingChunks.filter(
    (chunk) => cloudReachableMediaUrls(chunk.mediaUrls).length === 0
  );
  const multimodalChunks = existingChunks.filter(
    (chunk) => cloudReachableMediaUrls(chunk.mediaUrls).length > 0
  );

  for (let i = 0; i < textOnlyChunks.length; i += BATCH_SIZE) {
    const batch = textOnlyChunks.slice(i, i + BATCH_SIZE);
    try {
      const embeddings = await callMultiModalEmbedding(
        api,
        batch.map((chunk) => ({ text: chunk.content })),
        {
          enableFusion: false,
          expectCount: batch.length,
          context: `file ${options.fileAssetId} text batch ${i / BATCH_SIZE + 1}`,
        }
      );
      await Promise.all(
        batch.map((chunk, index) => persistEmbedding(chunk.id, embeddings[index]))
      );
    } catch (error) {
      console.error(`Failed to embed text batch for file ${options.fileAssetId}:`, error);
    }
  }

  for (let i = 0; i < multimodalChunks.length; i += CHUNK_EMBED_CONCURRENCY) {
    const batch = multimodalChunks.slice(i, i + CHUNK_EMBED_CONCURRENCY);
    await Promise.all(
      batch.map(async (chunk) => {
        try {
          const embedding = await embedChunkWithFallback({ chunk, api });
          await persistEmbedding(chunk.id, embedding);
        } catch (error) {
          console.error(`Failed to embed chunk ${chunk.id}:`, error);
        }
      })
    );
  }
}
