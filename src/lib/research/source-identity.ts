import { createHash } from "node:crypto";

export interface SourceIdentityInput {
  kind: "web" | "academic_paper" | "arxiv" | "doi" | "pmid" | "github" | "dataset" | "official_document" | "book" | "project_file" | "uploaded_file";
  url?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  pmid?: string | null;
  fileId?: string | null;
  /**
   * 稳定的 provider 作用域标识（例如 Sciverse docId/uniqueId）。仅在没有
   * DOI/arXiv/PMID/URL 等可跨 provider 归并的标识时兜底，避免不同 provider
   * 的 externalId 拼写差异永久制造重复 ResearchSource。
   */
  providerScopedId?: { provider: string; id: string } | null;
}

export interface SourceIdentity {
  canonicalKey: string;
  canonicalUrl: string | null;
  doi: string | null;
  arxivId: string | null;
  pmid: string | null;
}

export function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[.)\],;]+$/, "")
    .toLowerCase();
  return normalized.startsWith("10.") ? normalized : null;
}

export function normalizeArxivId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:)??([^/?#]+)$/i);
  return match?.[1]?.replace(/\.pdf$/i, "") ?? null;
}

export function normalizePmid(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{4,20})\/?$/i);
  return match?.[1] ?? null;
}

export function normalizeCanonicalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function buildSourceIdentity(input: SourceIdentityInput): SourceIdentity {
  const doi = normalizeDoi(input.doi ?? input.url);
  const arxivId = normalizeArxivId(input.arxivId ?? input.url);
  const pmid = normalizePmid(input.pmid ?? input.url);
  const canonicalUrl = normalizeCanonicalUrl(input.url);
  const providerScoped = input.providerScopedId && input.providerScopedId.id.trim()
    ? `${input.kind}:${input.providerScopedId.provider}:${input.providerScopedId.id.trim()}`
    : null;
  const canonicalKey = doi
    ? `doi:${doi}`
    : arxivId && (input.kind === "arxiv" || /arxiv\.org/i.test(input.url ?? ""))
      ? `arxiv:${arxivId.toLowerCase()}`
      : pmid && (input.kind === "pmid" || /pubmed/i.test(input.url ?? ""))
        ? `pmid:${pmid}`
        : input.fileId
          ? `${input.kind}:file:${input.fileId}`
          : canonicalUrl
            ? `url:${canonicalUrl}`
            : providerScoped
              ?? `${input.kind}:unknown:${createHash("sha256")
                  .update(JSON.stringify({ kind: input.kind, url: input.url ?? null }))
                  .digest("hex")}`;
  return { canonicalKey, canonicalUrl, doi, arxivId, pmid };
}
