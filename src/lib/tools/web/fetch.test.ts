import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  htmlToReadableMarkdown,
  isSafePublicHttpUrl,
} from "./fetch";

describe("web.fetch safety", () => {
  const originalAllowlist = process.env.WEB_FETCH_ALLOWLIST;

  beforeAll(() => {
    process.env.WEB_FETCH_ALLOWLIST = "example.com,example.org";
  });

  afterAll(() => {
    if (originalAllowlist === undefined) {
      delete process.env.WEB_FETCH_ALLOWLIST;
    } else {
      process.env.WEB_FETCH_ALLOWLIST = originalAllowlist;
    }
  });

  it("accepts public http(s) URLs on the configured allowlist", () => {
    expect(isSafePublicHttpUrl("https://example.com/article")).toBe(true);
    expect(isSafePublicHttpUrl("http://example.com/article")).toBe(true);
    expect(isSafePublicHttpUrl("https://sub.example.org/path")).toBe(true);
  });

  it("rejects public http(s) URLs not on the allowlist", () => {
    expect(isSafePublicHttpUrl("https://other-site.com/article")).toBe(false);
    expect(isSafePublicHttpUrl("https://notexample.com/article")).toBe(false);
  });

  it("blocks private, local, metadata, and non-http URLs even if allowlisted", () => {
    expect(isSafePublicHttpUrl("http://localhost:3000")).toBe(false);
    expect(isSafePublicHttpUrl("http://127.0.0.1:3000")).toBe(false);
    expect(isSafePublicHttpUrl("http://10.0.0.2/admin")).toBe(false);
    expect(isSafePublicHttpUrl("http://172.16.0.10/admin")).toBe(false);
    expect(isSafePublicHttpUrl("http://192.168.1.5/admin")).toBe(false);
    expect(isSafePublicHttpUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafePublicHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("blocks bracketed IPv6 private and loopback addresses", () => {
    const privateUrls = [
      "http://[::1]:8080/admin",
      "http://[0:0:0:0:0:0:0:1]:8080/admin",
      "http://[::ffff:127.0.0.1]:8080/admin",
      "http://[::ffff:10.0.0.1]:8080/admin",
      "http://[::ffff:172.16.0.10]:8080/admin",
      "http://[::ffff:ac10:0001]:8080/admin",
      "http://[::ffff:192.168.1.5]:8080/admin",
      "http://[fe90::1]:8080/admin",
      "http://[fc00::1]:8080/admin",
      "http://[100::1]:8080/admin",
      "http://[2001:2::1]:8080/admin",
      "http://[2001:db8::1]:8080/admin",
      "http://[64:ff9b::7f00:1]:8080/admin",
    ];

    for (const url of privateUrls) {
      const explicitlyAllowedHost = new URL(url).hostname.toLowerCase();
      expect(isSafePublicHttpUrl(url, [explicitlyAllowedHost]), url).toBe(false);
    }
  });

  it("accepts allowlisted public IPv6 without overblocking mapped public IPv4", () => {
    const urls = [
      "http://[2606:4700:4700::1111]/dns-query",
      "http://[::ffff:172.32.0.1]/public",
      "http://[::ffff:192.0.1.1]/public",
    ];

    for (const url of urls) {
      const explicitlyAllowedHost = new URL(url).hostname.toLowerCase();
      expect(isSafePublicHttpUrl(url, [explicitlyAllowedHost]), url).toBe(true);
    }
  });

  it("rejects everything when the allowlist is empty", () => {
    expect(isSafePublicHttpUrl("https://example.com/article", [])).toBe(false);
  });
});

describe("web.fetch html cleaning", () => {
  it("extracts readable article Markdown and drops scripts/navigation", async () => {
    const result = await htmlToReadableMarkdown(
      `
        <!doctype html>
        <html>
          <head><title>Browser title</title><script>window.evil = true</script></head>
          <body>
            <nav>Navigation should disappear</nav>
            <article>
              <h1>Readable title</h1>
              <p>First useful paragraph.</p>
              <p>Second useful paragraph.</p>
            </article>
          </body>
        </html>
      `,
      "https://example.com/article"
    );

    expect(result.title).toBe("Readable title");
    expect(result.markdown).toContain("# Readable title");
    expect(result.markdown).toContain("First useful paragraph.");
    expect(result.markdown).not.toContain("Navigation should disappear");
    expect(result.markdown).not.toContain("window.evil");
  });
});
