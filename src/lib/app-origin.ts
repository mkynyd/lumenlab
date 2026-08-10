import "server-only";

/**
 * Resolve the canonical public application origin for server-side redirects.
 *
 * In production, reverse proxies may expose the Next.js process's internal
 * origin (for example https://localhost:3000) through request.nextUrl. Auth
 * links must therefore use the explicitly configured public AUTH_URL.
 */
export function resolveAppOrigin(requestOrigin: string): string {
  const configured = process.env.AUTH_URL?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_URL must be configured in production");
    }
    return new URL(requestOrigin).origin;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("AUTH_URL must be a valid HTTP(S) URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AUTH_URL must be a valid HTTP(S) URL");
  }

  return url.origin;
}
