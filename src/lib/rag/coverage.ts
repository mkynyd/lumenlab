import { searchChunksByKeyword } from "./vector-store";

/**
 * Coverage verdict distinguishes "the material does not contain this topic"
 * from "the material has it but retrieval missed it".
 */
export type CoverageVerdict = "material_absent" | "retrieval_miss" | "covered";

const QUERY_RUN_RE = /[\p{Script=Han}a-z0-9_+-]{2,}/gu;

/** True when `content` contains any meaningful term of `query`. */
export function containsQueryTerms(content: string, query: string): boolean {
  const runs = query.toLowerCase().match(QUERY_RUN_RE) ?? [];
  if (runs.length === 0) {
    return content.toLowerCase().includes(query.toLowerCase());
  }
  const normalized = content.toLowerCase();
  return runs.some((run) => normalized.includes(run));
}

/**
 * Classify why a topic is not among the retrieval results:
 * - `covered`: a retrieved chunk already mentions the query terms;
 * - `retrieval_miss`: nothing retrieved matched, but a corpus-wide keyword
 *   scan finds the terms — retrieval failed, the material exists;
 * - `material_absent`: even the fallback scan finds nothing — the material
 *   genuinely lacks the topic.
 */
export async function classifyCoverage(params: {
  userId: string;
  projectId: string;
  query: string;
  retrievalResults: Array<{ fileAssetId: string | null; content: string }>;
}): Promise<CoverageVerdict> {
  if (
    params.retrievalResults.some((result) =>
      containsQueryTerms(result.content, params.query)
    )
  ) {
    return "covered";
  }
  const fallback = await searchChunksByKeyword({
    userId: params.userId,
    projectId: params.projectId,
    query: params.query,
    limit: 5,
  });
  if (
    fallback.some((chunk) => containsQueryTerms(chunk.content, params.query))
  ) {
    return "retrieval_miss";
  }
  return "material_absent";
}
