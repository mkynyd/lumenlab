export type AgentSourceType = "web" | "project_file" | "arxiv" | "artifact";

export interface AgentSource {
  type: AgentSourceType;
  title: string;
  url?: string;
  fileId?: string;
  artifactId?: string;
  arxivId?: string;
  snippet?: string;
  usedAt?: number;
  metadata?: Record<string, unknown>;
}

function normalizeUrlForSource(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sourceKey(source: AgentSource) {
  if (source.url) return `${source.type}:${normalizeUrlForSource(source.url)}`;
  if (source.fileId) return `${source.type}:file:${source.fileId}`;
  if (source.artifactId) return `${source.type}:artifact:${source.artifactId}`;
  if (source.arxivId) return `${source.type}:arxiv:${source.arxivId.toLowerCase()}`;
  return `${source.type}:title:${source.title}`;
}

export function aggregateSources(sources: AgentSource[], maxSources = 20): AgentSource[] {
  const seen = new Set<string>();
  const result: AgentSource[] = [];
  for (const source of sources) {
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
    if (result.length >= maxSources) break;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function extractSourcesFromToolResult(
  toolId: string,
  result: Record<string, unknown>
): AgentSource[] {
  if (toolId === "project_rag.search") {
    const hits = Array.isArray(result.hits) ? result.hits : [];
    return hits.flatMap((hit) => {
      const record = asRecord(hit);
      if (!record) return [];
      const title = asString(record.file) ?? asString(record.title);
      const fileId = asString(record.fileId);
      if (!title || !fileId) return [];
      const score = asNumber(record.score);
      return [{
        type: "project_file" as const,
        title,
        fileId,
        snippet: asString(record.snippet),
        ...(score === undefined ? {} : { metadata: { score } }),
      }];
    });
  }

  if (toolId === "project_files.read") {
    const title = asString(result.name) ?? asString(result.originalName);
    const fileId = asString(result.id) ?? asString(result.fileId);
    if (!title || !fileId) return [];
    return [{
      type: "project_file",
      title,
      fileId,
      metadata: {
        status: result.status,
        mimeType: result.mimeType,
      },
    }];
  }

  if (toolId === "project_files.list") {
    const files = Array.isArray(result.files) ? result.files : [];
    return files.flatMap((file) => {
      const record = asRecord(file);
      if (!record) return [];
      const title = asString(record.name) ?? asString(record.originalName);
      const fileId = asString(record.id);
      if (!title || !fileId) return [];
      return [{ type: "project_file" as const, title, fileId }];
    });
  }

  if (toolId === "web.fetch") {
    const url = asString(result.url);
    if (!url) return [];
    return [{
      type: "web",
      title: asString(result.title) ?? url,
      url,
      metadata: { status: result.status },
    }];
  }

  if (toolId === "web.search") {
    const sources = Array.isArray(result.sources) ? result.sources : [];
    return sources.flatMap((source) => {
      const record = asRecord(source);
      if (!record) return [];
      const url = asString(record.url);
      if (!url) return [];
      return [{
        type: "web" as const,
        title: asString(record.title) ?? url,
        url,
      }];
    });
  }

  if (toolId === "artifact.save") {
    const artifactId = asString(result.id);
    const title = asString(result.title);
    if (!artifactId || !title) return [];
    return [{
      type: "artifact",
      title,
      artifactId,
      metadata: { type: result.type },
    }];
  }

  if (toolId.startsWith("arxiv.")) {
    const arxivId = asString(result.arxivId) ?? asString(result.id);
    const title = asString(result.title);
    if (!arxivId || !title) return [];
    return [{
      type: "arxiv",
      title,
      arxivId,
      url: asString(result.url) ?? `https://arxiv.org/abs/${arxivId}`,
    }];
  }

  return [];
}
