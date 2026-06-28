import { Configuration, DashscopeApi } from "dashscope-sdk-official";
import { prisma } from "@/lib/db";

export const EMBEDDING_MODEL = "qwen3-vl-embedding";
export const EMBEDDING_DIM = 1024;
const BATCH_SIZE = 10;
const CHUNK_EMBED_CONCURRENCY = 5;
const MAX_MEDIA_PER_FUSION = 5; // qwen3-vl-embedding limit per fusion request

function getApi(apiKey: string) {
  return new DashscopeApi(new Configuration({ apiKey }));
}

function normalizeEmbeddingInput(items: { text?: string; image?: string; video?: string }[]) {
  return items.map((item) => {
    if (item.video) return { video: item.video };
    if (item.image) return { image: item.image };
    return { text: item.text ?? "" };
  });
}

interface EmbeddingCallOptions {
  enableFusion?: boolean;
  expectCount?: number;
  context?: string;
}

async function callMultiModalEmbedding(
  api: DashscopeApi,
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
  const embeddings = await embedTexts([query], apiKey);
  return embeddings[0];
}

export async function embedChunksForFile(options: {
  fileAssetId: string;
  apiKey: string;
}): Promise<void> {
  const chunks = await prisma.documentChunk.findMany({
    where: { fileAssetId: options.fileAssetId },
    select: { id: true, content: true, mediaUrls: true },
    orderBy: { chunkIndex: "asc" },
  });
  if (chunks.length === 0) return;

  const api = getApi(options.apiKey);

  for (let i = 0; i < chunks.length; i += CHUNK_EMBED_CONCURRENCY) {
    const batch = chunks.slice(i, i + CHUNK_EMBED_CONCURRENCY);
    await Promise.all(
      batch.map(async (chunk) => {
        const mediaUrls = (chunk.mediaUrls ?? []).slice(0, MAX_MEDIA_PER_FUSION);
        const input: { text?: string; image?: string; video?: string }[] = [
          { text: chunk.content },
        ];
        for (const url of mediaUrls) {
          if (/\.(mp4|mov|avi|webm|mkv|flv|mpeg|mpg)(\?.*)?$/i.test(url)) {
            input.push({ video: url });
          } else {
            input.push({ image: url });
          }
        }

        const embeddings = await callMultiModalEmbedding(api, input, {
          enableFusion: true,
          expectCount: 1,
          context: `chunk ${chunk.id}`,
        });

        const vector = `[${embeddings[0].join(",")}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE "DocumentChunk" SET embedding = $1::vector WHERE id = $2`,
          vector,
          chunk.id
        );
      })
    );
  }
}
