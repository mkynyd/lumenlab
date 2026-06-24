import { logger } from "@/lib/logger";

const ALLOWED_HOSTS = new Set([
  "arxiv.org",
  "github.com",
  "raw.githubusercontent.com",
  "wikipedia.org",
  "en.wikipedia.org",
  "zh.wikipedia.org",
  "openreview.net",
]);

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 1_500_000;

function isAllowedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (ALLOWED_HOSTS.has(host)) return true;
    return host.endsWith(".arxiv.org") || host.endsWith(".wikipedia.org");
  } catch {
    return false;
  }
}

export async function webFetch(
  url: string
): Promise<Record<string, unknown>> {
  if (!isAllowedUrl(url)) {
    return { error: "URL_NOT_ALLOWED", url };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LumenLab-Agent/1.0" },
    });
    if (!response.ok) {
      return { error: "FETCH_FAILED", status: response.status, url };
    }
    const reader = response.body?.getReader();
    if (!reader) return { error: "NO_BODY", url };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        return { error: "BODY_TOO_LARGE", url, maxBytes: MAX_BODY_BYTES };
      }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8").decode(
      Buffer.concat(chunks.map((c) => Buffer.from(c)))
    );
    return {
      url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: text.slice(0, 20_000),
      truncated: text.length > 20_000,
    };
  } catch (error) {
    logger.warn("web.fetch failed", { error: String(error), url });
    return { error: "FETCH_ERROR", url };
  } finally {
    clearTimeout(timeout);
  }
}