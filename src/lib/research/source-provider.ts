import { randomUUID } from "node:crypto";
import { createPrismaToolRunner } from "@/lib/agent/tools/tool-runner";
import type { ToolRunner } from "@/lib/agent/tools/tool-runner";

export interface ResearchProviderContext {
  userId: string;
  conversationId: string;
  executionId: string;
  runId: string;
  projectId?: string | null;
  signal: AbortSignal;
}

export interface ResearchCandidate {
  provider: string;
  kind: "web" | "arxiv" | "project_file";
  externalId: string;
  title: string;
  url: string | null;
  metadata: Record<string, unknown>;
}

export interface ReadResearchSource {
  candidate: ResearchCandidate;
  title: string;
  content: string;
  excerpt: string;
  locator: Record<string, unknown>;
  sourceVersion: string | null;
  metadata: Record<string, unknown>;
}

export interface ResearchSourceProvider {
  search(context: ResearchProviderContext, question: string): Promise<ResearchCandidate[]>;
  read(context: ResearchProviderContext, candidate: ResearchCandidate): Promise<ReadResearchSource | null>;
}

export function createToolBackedResearchSourceProvider(input: { toolRunner?: ToolRunner } = {}): ResearchSourceProvider {
  const toolRunner = input.toolRunner ?? createPrismaToolRunner();

  async function runTool(context: ResearchProviderContext, toolId: string, args: Record<string, unknown>) {
    const result = await toolRunner.run(
      {
        call: { id: randomUUID(), toolId, arguments: args },
        context: {
          userId: context.userId,
          conversationId: context.conversationId,
          projectId: context.projectId ?? undefined,
          runId: context.runId,
          agentExecutionId: context.executionId,
          skillId: "literature-review",
          signal: context.signal,
          sessionApprovals: new Map(),
        },
      },
      () => undefined
    );
    return result.status === "succeeded" ? result.summary : null;
  }

  return {
    async search(context, question) {
      const candidates = new Map<string, ResearchCandidate>();
      const web = await runTool(context, "web.search", { query: question, maxResults: 5 });
      const webSources = Array.isArray(web?.sources) ? web.sources : [];
      for (const item of webSources) {
        if (!item || typeof item !== "object") continue;
        const url = typeof item.url === "string" ? item.url : null;
        if (!url) continue;
        const title = typeof item.title === "string" ? item.title : url;
        candidates.set(`web:${url}`, { provider: "web", kind: "web", externalId: url, title, url, metadata: {} });
      }

      const arxiv = await runTool(context, "arxiv.search", { query: question, maxResults: 5 });
      const arxivResults = Array.isArray(arxiv?.results) ? arxiv.results : [];
      for (const item of arxivResults) {
        if (!item || typeof item !== "object") continue;
        const value = item as Record<string, unknown>;
        const arxivId = typeof value.arxivId === "string" ? value.arxivId : null;
        if (!arxivId) continue;
        const url = typeof value.url === "string" ? value.url : `https://arxiv.org/abs/${arxivId}`;
        candidates.set(`arxiv:${arxivId}`, {
          provider: "arxiv",
          kind: "arxiv",
          externalId: arxivId,
          title: typeof value.title === "string" ? value.title : arxivId,
          url,
          metadata: { authors: value.authors, year: value.year, abstract: value.abstract, category: value.category },
        });
      }

      if (context.projectId) {
        const rag = await runTool(context, "project_rag.search", { projectId: context.projectId, query: question, maxResults: 5 });
        const hits = Array.isArray(rag?.hits) ? rag.hits : [];
        for (const item of hits) {
          if (!item || typeof item !== "object") continue;
          const value = item as Record<string, unknown>;
          const fileId = typeof value.fileId === "string" ? value.fileId : null;
          if (!fileId) continue;
          candidates.set(`project:${fileId}`, {
            provider: "project",
            kind: "project_file",
            externalId: fileId,
            title: typeof value.file === "string" ? value.file : fileId,
            url: null,
            metadata: { snippet: value.snippet, score: value.score },
          });
        }
      }
      return [...candidates.values()];
    },

    async read(context, candidate) {
      const toolId = candidate.kind === "web"
        ? "web.fetch"
        : candidate.kind === "arxiv"
          ? "arxiv.fetch"
          : "project_files.read";
      const args = candidate.kind === "project_file"
        ? { projectId: context.projectId, fileId: candidate.externalId, maxChars: 12_000, offset: 0 }
        : candidate.kind === "arxiv"
          ? { url: candidate.url ?? `https://arxiv.org/abs/${candidate.externalId}` }
          : { url: candidate.url };
      const result = await runTool(context, toolId, args);
      if (!result) return null;
      const content = candidate.kind === "project_file"
        ? typeof result.text === "string" ? result.text : ""
        : candidate.kind === "arxiv"
          ? typeof result.markdown === "string" ? result.markdown : typeof result.text === "string" ? result.text : ""
          : typeof result.markdown === "string" ? result.markdown : typeof result.text === "string" ? result.text : "";
      if (!content.trim()) return null;
      return {
        candidate,
        title: typeof result.title === "string" ? result.title : candidate.title,
        content,
        excerpt: content.replace(/\s+/g, " ").trim().slice(0, 800),
        locator: candidate.kind === "project_file" ? { kind: "file", fileId: candidate.externalId, offset: result.offset ?? 0 } : { kind: "url", url: candidate.url, provider: candidate.provider },
        sourceVersion: candidate.kind === "arxiv" && typeof result.year === "number" ? String(result.year) : null,
        metadata: result,
      };
    },
  };
}
