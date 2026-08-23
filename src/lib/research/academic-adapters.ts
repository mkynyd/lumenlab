import { normalizeDoi, normalizePmid } from "./source-identity";
import type { ReadResearchSource, ResearchCandidate, ResearchProviderContext } from "./source-provider";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface AcademicSourceAdapter {
  provider: "openalex" | "crossref" | "semantic_scholar" | "pubmed";
  search(context: ResearchProviderContext, question: string): Promise<ResearchCandidate[]>;
  read(context: ResearchProviderContext, candidate: ResearchCandidate): Promise<ReadResearchSource | null>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function yearValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function publishedYear(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parts = (value as Record<string, unknown>)["date-parts"];
  return Array.isArray(parts) && Array.isArray(parts[0]) && typeof parts[0][0] === "number" ? String(parts[0][0]) : null;
}

function openAlexAbstract(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries: Array<{ position: number; word: string }> = [];
  for (const [word, positions] of Object.entries(value)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) if (typeof position === "number") entries.push({ position, word });
  }
  return entries.sort((left, right) => left.position - right.position).map((entry) => entry.word).join(" ") || null;
}

async function fetchJson(
  context: ResearchProviderContext,
  url: string,
  fetcher: Fetcher
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  context.signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/json", "user-agent": "LumenLab/1.0 research-source-adapter" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", abort);
  }
}

function academicCandidate(input: {
  provider: AcademicSourceAdapter["provider"];
  externalId: string;
  title: string;
  url: string | null;
  metadata: Record<string, unknown>;
  kind?: ResearchCandidate["kind"];
}): ResearchCandidate {
  return { provider: input.provider, kind: input.kind ?? "academic_paper", externalId: input.externalId, title: input.title, url: input.url, metadata: input.metadata };
}

function openAlexCandidate(item: Record<string, unknown>): ResearchCandidate | null {
  const doi = normalizeDoi(stringValue(item.doi));
  const externalId = doi ?? stringValue(item.id);
  const title = stringValue(item.title);
  if (!externalId || !title) return null;
  const primaryLocation = item.primary_location && typeof item.primary_location === "object" ? item.primary_location as Record<string, unknown> : null;
  const url = stringValue(primaryLocation?.landing_page_url) ?? (doi ? `https://doi.org/${doi}` : stringValue(item.id));
  return academicCandidate({ provider: "openalex", externalId, title, url, metadata: { doi, publicationYear: yearValue(item.publication_year), openAlexId: item.id, type: item.type } });
}

function crossrefCandidate(item: Record<string, unknown>): ResearchCandidate | null {
  const doi = normalizeDoi(stringValue(item.DOI));
  const title = Array.isArray(item.title) ? stringValue(item.title[0]) : stringValue(item.title);
  if (!doi || !title) return null;
  return academicCandidate({ provider: "crossref", externalId: doi, title, url: `https://doi.org/${doi}`, metadata: { doi, published: item.published, type: item.type, publisher: item.publisher } });
}

function semanticScholarCandidate(item: Record<string, unknown>): ResearchCandidate | null {
  const externalIds = item.externalIds && typeof item.externalIds === "object" ? item.externalIds as Record<string, unknown> : {};
  const doi = normalizeDoi(stringValue(externalIds.DOI));
  const arxivId = stringValue(externalIds.ArXiv);
  const paperId = stringValue(item.paperId);
  const externalId = doi ?? arxivId ?? paperId;
  const title = stringValue(item.title);
  if (!externalId || !title) return null;
  const url = doi ? `https://doi.org/${doi}` : arxivId ? `https://arxiv.org/abs/${arxivId}` : stringValue(item.url);
  return academicCandidate({ provider: "semantic_scholar", externalId, title, url, metadata: { doi, arxivId, paperId, year: yearValue(item.year), abstract: stringValue(item.abstract) } });
}

function pubmedCandidate(item: Record<string, unknown>, pmid: string): ResearchCandidate | null {
  const title = stringValue(item.title);
  const normalizedPmid = normalizePmid(pmid);
  if (!title || !normalizedPmid) return null;
  return academicCandidate({ provider: "pubmed", kind: "pmid", externalId: normalizedPmid, title, url: `https://pubmed.ncbi.nlm.nih.gov/${normalizedPmid}/`, metadata: { pmid: normalizedPmid, pubdate: item.pubdate, authors: item.authors } });
}

function readResult(input: {
  candidate: ResearchCandidate;
  content: string;
  title?: string | null;
  abstract?: string | null;
  sourceVersion?: string | null;
  locator: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): ReadResearchSource | null {
  const content = input.content.trim();
  if (!content) return null;
  const excerpt = (input.abstract?.trim() || content.replace(/\s+/g, " ")).slice(0, 1_200);
  return { candidate: input.candidate, title: input.title?.trim() || input.candidate.title, content, excerpt, locator: input.locator, sourceVersion: input.sourceVersion ?? null, metadata: input.metadata };
}

export function createAcademicSourceAdapters(input: { fetcher?: Fetcher } = {}): AcademicSourceAdapter[] {
  const fetcher = input.fetcher ?? fetch;
  return [
    {
      provider: "openalex",
      async search(context, question) {
        const payload = await fetchJson(context, `https://api.openalex.org/works?search=${encodeURIComponent(question)}&per-page=5`, fetcher);
        const results = Array.isArray(payload?.results) ? payload.results : [];
        return results.flatMap((item) => item && typeof item === "object" ? [openAlexCandidate(item as Record<string, unknown>)].filter((candidate): candidate is ResearchCandidate => Boolean(candidate)) : []);
      },
      async read(context, candidate) {
        const id = candidate.externalId.startsWith("10.") ? `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(candidate.externalId)}` : `https://api.openalex.org/works/${encodeURIComponent(candidate.externalId)}`;
        const payload = await fetchJson(context, id, fetcher);
        if (!payload) return null;
        const abstract = openAlexAbstract(payload.abstract_inverted_index);
        return readResult({ candidate, content: JSON.stringify(payload), title: stringValue(payload.title), abstract, sourceVersion: yearValue(payload.publication_year)?.toString(), locator: { kind: "openalex", id: candidate.externalId }, metadata: payload });
      },
    },
    {
      provider: "crossref",
      async search(context, question) {
        const payload = await fetchJson(context, `https://api.crossref.org/works?query=${encodeURIComponent(question)}&rows=5`, fetcher);
        const items = payload?.message && typeof payload.message === "object" ? (payload.message as Record<string, unknown>).items : null;
        return Array.isArray(items) ? items.flatMap((item) => item && typeof item === "object" ? [crossrefCandidate(item as Record<string, unknown>)].filter((candidate): candidate is ResearchCandidate => Boolean(candidate)) : []) : [];
      },
      async read(context, candidate) {
        const payload = await fetchJson(context, `https://api.crossref.org/works/${encodeURIComponent(candidate.externalId)}`, fetcher);
        const message = payload?.message && typeof payload.message === "object" ? payload.message as Record<string, unknown> : null;
        if (!message) return null;
        const title = Array.isArray(message.title) ? stringValue(message.title[0]) : stringValue(message.title);
        return readResult({ candidate, content: JSON.stringify(message), title, sourceVersion: publishedYear(message.published), locator: { kind: "crossref", doi: candidate.externalId }, metadata: message });
      },
    },
    {
      provider: "semantic_scholar",
      async search(context, question) {
        const payload = await fetchJson(context, `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(question)}&limit=5&fields=title,abstract,year,url,externalIds`, fetcher);
        const results = Array.isArray(payload?.data) ? payload.data : [];
        return results.flatMap((item) => item && typeof item === "object" ? [semanticScholarCandidate(item as Record<string, unknown>)].filter((candidate): candidate is ResearchCandidate => Boolean(candidate)) : []);
      },
      async read(context, candidate) {
        const payload = await fetchJson(context, `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(candidate.externalId)}?fields=title,abstract,year,url,externalIds,authors`, fetcher);
        if (!payload) return null;
        return readResult({ candidate, content: JSON.stringify(payload), title: stringValue(payload.title), abstract: stringValue(payload.abstract), sourceVersion: yearValue(payload.year)?.toString(), locator: { kind: "semantic_scholar", id: candidate.externalId }, metadata: payload });
      },
    },
    {
      provider: "pubmed",
      async search(context, question) {
        const search = await fetchJson(context, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(question)}&retmode=json&retmax=5`, fetcher);
        const esearch = search?.esearchresult && typeof search.esearchresult === "object" ? search.esearchresult as Record<string, unknown> : null;
        const ids = Array.isArray(esearch?.idlist) ? esearch.idlist.filter((id): id is string => typeof id === "string") : [];
        if (ids.length === 0) return [];
        const summary = await fetchJson(context, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`, fetcher);
        const result = summary?.result && typeof summary.result === "object" ? summary.result as Record<string, unknown> : null;
        return ids.flatMap((id) => result?.[id] && typeof result[id] === "object" ? [pubmedCandidate(result[id] as Record<string, unknown>, id)].filter((candidate): candidate is ResearchCandidate => Boolean(candidate)) : []);
      },
      async read(context, candidate) {
        const payload = await fetchJson(context, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(candidate.externalId)}&retmode=json`, fetcher);
        const result = payload?.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : null;
        const item = result?.[candidate.externalId] && typeof result[candidate.externalId] === "object" ? result[candidate.externalId] as Record<string, unknown> : null;
        if (!item) return null;
        return readResult({ candidate, content: JSON.stringify(item), title: stringValue(item.title), sourceVersion: stringValue(item.pubdate), locator: { kind: "pubmed", pmid: candidate.externalId }, metadata: item });
      },
    },
  ];
}
