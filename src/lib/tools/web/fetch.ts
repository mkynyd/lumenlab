import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { htmlToText } from "html-to-text";
import { logger } from "@/lib/logger";

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const MAX_RETURN_CHARS = 20_000;

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(hostname: string) {
  const lower = hostname.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:") ||
    lower.startsWith("::ffff:127.") ||
    lower.startsWith("::ffff:10.") ||
    lower.startsWith("::ffff:192.168.") ||
    lower.startsWith("::ffff:169.254.")
  );
}

function isPrivateIp(hostname: string) {
  const type = isIP(hostname);
  if (type === 4) return isPrivateIpv4(hostname);
  if (type === 6) return isPrivateIpv6(hostname);
  return false;
}

function getFetchAllowlist(): string[] {
  const raw = process.env.WEB_FETCH_ALLOWLIST;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  const normalizedHost = host.toLowerCase();
  return allowlist.some((domain) => {
    if (!domain) return false;
    return (
      normalizedHost === domain || normalizedHost.endsWith(`.${domain}`)
    );
  });
}

export function isSafePublicHttpUrl(
  rawUrl: string,
  allowlist: string[] = getFetchAllowlist()
): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host === "metadata.google.internal"
    ) {
      return false;
    }
    if (isIP(host) && isPrivateIp(host)) return false;
    if (!hostMatchesAllowlist(host, allowlist)) return false;
    return true;
  } catch {
    return false;
  }
}

async function assertPublicResolvedAddress(url: URL) {
  if (isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) {
      throw new Error("URL_NOT_ALLOWED");
    }
    return;
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error("URL_NOT_ALLOWED");
  }
}

function decodeBody(chunks: Uint8Array[]) {
  return new TextDecoder("utf-8").decode(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  );
}

export async function htmlToReadableMarkdown(
  html: string,
  url: string
): Promise<{ title: string; markdown: string; text: string }> {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  for (const node of document.querySelectorAll(
    "script, style, noscript, iframe, nav, header, footer, aside"
  )) {
    node.remove();
  }

  const article = new Readability(document).parse();
  const title =
    document.querySelector("article h1, main h1, h1")?.textContent?.trim() ||
    article?.title?.trim() ||
    document.title?.trim() ||
    url;
  const htmlContent = article?.content || document.body?.innerHTML || html;
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.remove(["script", "style", "noscript", "iframe"]);
  const markdown = turndown.turndown(htmlContent).replace(/\n{3,}/g, "\n\n").trim();
  const text = htmlToText(htmlContent, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: false } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
    ],
  }).trim();
  return { title, markdown, text };
}

async function safeFetchWithRedirects(rawUrl: string, signal: AbortSignal) {
  let current = new URL(rawUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (!isSafePublicHttpUrl(current.toString())) {
      return { error: "URL_NOT_ALLOWED", url: current.toString() } as const;
    }
    try {
      await assertPublicResolvedAddress(current);
    } catch {
      return { error: "URL_NOT_ALLOWED", url: current.toString() } as const;
    }
    const response = await fetch(current, {
      signal,
      redirect: "manual",
      headers: { "user-agent": "LumenLab-Agent/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, url: current.toString() };
      current = new URL(location, current);
      continue;
    }
    return { response, url: current.toString() };
  }
  return { error: "TOO_MANY_REDIRECTS", url: current.toString() } as const;
}

export async function webFetch(
  url: string
): Promise<Record<string, unknown>> {
  if (!isSafePublicHttpUrl(url)) {
    return { error: "URL_NOT_ALLOWED", url };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const fetched = await safeFetchWithRedirects(url, controller.signal);
    if ("error" in fetched) return fetched;
    const { response } = fetched;
    if (!response.ok) {
      return { error: "FETCH_FAILED", status: response.status, url: fetched.url };
    }
    const reader = response.body?.getReader();
    if (!reader) return { error: "NO_BODY", url: fetched.url };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        return { error: "BODY_TOO_LARGE", url: fetched.url, maxBytes: MAX_BODY_BYTES };
      }
      chunks.push(value);
    }
    const text = decodeBody(chunks);
    const contentType = response.headers.get("content-type") ?? "";
    const isHtml = /\bhtml\b/i.test(contentType) || /<html[\s>]/i.test(text);
    const readable = isHtml
      ? await htmlToReadableMarkdown(text, fetched.url)
      : {
          title: fetched.url,
          markdown: text,
          text,
        };
    const output = readable.markdown || readable.text;
    return {
      url: fetched.url,
      status: response.status,
      contentType,
      title: readable.title,
      markdown: output.slice(0, MAX_RETURN_CHARS),
      text: readable.text.slice(0, MAX_RETURN_CHARS),
      body: output.slice(0, MAX_RETURN_CHARS),
      truncated: output.length > MAX_RETURN_CHARS,
    };
  } catch (error) {
    logger.warn("web.fetch failed", { error: String(error), url });
    return { error: "FETCH_ERROR", url };
  } finally {
    clearTimeout(timeout);
  }
}
