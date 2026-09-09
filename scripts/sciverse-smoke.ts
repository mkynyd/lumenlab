/**
 * Minimal real-API smoke test for the Sciverse tool handlers.
 * Reads SCIVERSE_API_TOKEN from the environment; never prints it.
 * Three bounded calls only: search -> semantic_search -> read (if accessible).
 */
import { sciverseRead, sciverseSearch, sciverseSemanticSearch } from "@/lib/tools/sciverse/handlers";

const ctx = { userId: "smoke", conversationId: "smoke" } as never;

function summarize(value: unknown): string {
  return JSON.stringify(value, null, 2).slice(0, 1200);
}

async function main() {
  if (!process.env.SCIVERSE_API_TOKEN?.trim()) {
    console.error("SCIVERSE_API_TOKEN missing");
    process.exit(1);
  }

  console.log("== 1. sciverse.search ==");
  const search = await sciverseSearch(ctx, { titleContains: "Attention Is All You Need", pageSize: 3 });
  console.log(summarize(search));

  console.log("== 2. sciverse.semantic_search ==");
  const semantic = await sciverseSemanticSearch(ctx, {
    query: "How do transformer models handle long-range dependencies in sequences?",
    topK: 3,
  });
  console.log(summarize(semantic));

  const hits = (semantic as { hits?: Array<{ docId: string; offset: number }> }).hits ?? [];
  const hit = hits[0];
  if (hit?.docId) {
    console.log("== 3. sciverse.read ==");
    const read = await sciverseRead(ctx, { docId: hit.docId, offset: Math.max(0, hit.offset), limit: 600 });
    console.log(summarize(read));
  } else {
    console.log("== 3. sciverse.read skipped: no docId in hits ==");
  }
}

main().catch((error) => {
  console.error("smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
