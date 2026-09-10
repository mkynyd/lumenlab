/**
 * Minimal production smoke for web.search (AnySearch primary). Never prints keys.
 * Usage: npx tsx scripts/anysearch-smoke.ts
 */
import { webSearch } from "@/lib/tools/web/search";

async function main() {
  const result = await webSearch({ userId: "smoke", conversationId: "smoke" } as never, "LumenLab Deep Research Sciverse", { maxResults: 3 });
  const sources = result.sources ?? [];
  console.log("[anysearch-smoke] summary preview:", (result.summary ?? "").slice(0, 300));
  console.log("[anysearch-smoke] sources:", sources.slice(0, 3).map((source) => ({ title: source.title?.slice(0, 60), url: source.url?.slice(0, 90) })));
  if (sources.length === 0 || !sources[0]?.url) {
    console.error("[anysearch-smoke] FAILED: no valid source returned");
    process.exit(1);
  }
  console.log("[anysearch-smoke] OK");
}

main().catch((error) => {
  console.error("[anysearch-smoke] crashed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
