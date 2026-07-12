import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type LookupCallback = (
  error: Error | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number
) => void;

type MockDispatcher = {
  connect: {
    lookup: (
      hostname: string,
      options: { family: number; all: boolean },
      callback: LookupCallback
    ) => void;
  };
};

const mocks = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
  fetch: vi.fn(),
  destroy: vi.fn(async () => {}),
}));

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("node:dns/promises") & { default?: Record<string, unknown> }
  >();
  return {
    ...actual,
    default: { ...actual.default, lookup: mocks.dnsLookup },
    lookup: mocks.dnsLookup,
  };
});

vi.mock("undici", () => ({
  Agent: class MockAgent {
    readonly connect: MockDispatcher["connect"];

    constructor(options: MockDispatcher) {
      this.connect = options.connect;
    }

    destroy() {
      return mocks.destroy();
    }
  },
  fetch: mocks.fetch,
}));

import { isSafePublicHttpUrl, webFetch } from "./fetch";

describe("web.fetch DNS pinning", () => {
  const originalAllowlist = process.env.WEB_FETCH_ALLOWLIST;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEB_FETCH_ALLOWLIST = "rebind.example,next.example";
  });

  afterAll(() => {
    if (originalAllowlist === undefined) {
      delete process.env.WEB_FETCH_ALLOWLIST;
    } else {
      process.env.WEB_FETCH_ALLOWLIST = originalAllowlist;
    }
  });

  it("connects through the already validated address without resolving DNS again", async () => {
    expect(isSafePublicHttpUrl("https://rebind.example/article")).toBe(true);
    mocks.dnsLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const connectedAddresses: string[] = [];
    mocks.fetch.mockImplementation(async (url, options) => {
      connectedAddresses.push(
        await resolvePinnedAddress(options.dispatcher, new URL(url).hostname)
      );
      return new Response("safe body", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    });

    const result = await webFetch("https://rebind.example/article");

    expect(mocks.dnsLookup).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 200, body: "safe body" });
    expect(connectedAddresses).toEqual(["93.184.216.34"]);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("revalidates and pins each redirect destination independently", async () => {
    mocks.dnsLookup.mockImplementation(async (hostname: string) =>
      hostname === "rebind.example"
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "1.1.1.1", family: 4 }]
    );
    const connectedAddresses: string[] = [];
    mocks.fetch.mockImplementation(async (url, options) => {
      const current = new URL(url);
      connectedAddresses.push(
        await resolvePinnedAddress(options.dispatcher, current.hostname)
      );
      if (current.hostname === "rebind.example") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://next.example/final" },
        });
      }
      return new Response("redirected body", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    });

    const result = await webFetch("https://rebind.example/start");

    expect(result).toMatchObject({
      status: 200,
      url: "https://next.example/final",
      body: "redirected body",
    });
    expect(connectedAddresses).toEqual(["93.184.216.34", "1.1.1.1"]);
    expect(mocks.dnsLookup).toHaveBeenCalledTimes(2);
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
});

function resolvePinnedAddress(
  dispatcher: MockDispatcher,
  hostname: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    dispatcher.connect.lookup(
      hostname,
      { family: 4, all: false },
      (error, address) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(typeof address === "string" ? address : address[0].address);
      }
    );
  });
}
