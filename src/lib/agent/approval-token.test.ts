import { describe, expect, it, vi, beforeEach } from "vitest";
import { canonicalJson, hashArguments } from "./approval-token";

vi.mock("@/lib/db", () => {
  return {
    prisma: {
      approvalToken: {
        create: vi.fn(async ({ data }: { data: { tokenHash: string; argumentsHash: string; requestId: string; expiresAt: Date } }) => {
          const list = ((globalThis as { __recorded?: unknown[] }).__recorded ??= []) as Array<{
            id: string;
            tokenHash: string;
            argumentsHash: string;
            requestId: string;
            consumedAt: Date | null;
            expiresAt: Date;
          }>;
          const row = {
            id: `tkn-${list.length + 1}`,
            tokenHash: data.tokenHash,
            argumentsHash: data.argumentsHash,
            requestId: data.requestId,
            consumedAt: null,
            expiresAt: data.expiresAt,
          };
          list.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<{ tokenHash: string; consumedAt: Date }> }) => {
          const list = (globalThis as { __recorded?: unknown[] }).__recorded as Array<{ id: string }>;
          const row = list.find((r) => r.id === where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
          const list = (globalThis as { __recorded?: unknown[] }).__recorded as Array<{ tokenHash: string }>;
          return list.find((r) => r.tokenHash === where.tokenHash) ?? null;
        }),
      },
    },
  };
});

type TokenRow = {
  id: string;
  tokenHash: string;
  argumentsHash: string;
  requestId: string;
  consumedAt: Date | null;
  expiresAt: Date;
};

beforeEach(() => {
  (globalThis as { __recorded?: unknown }).__recorded = [];
});

function getRows(): TokenRow[] {
  return (globalThis as { __recorded?: TokenRow[] }).__recorded ?? [];
}

describe("approval-token", () => {
  it("canonicalJson sorts keys deterministically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: { y: 1, x: 2 } })).toBe(
      canonicalJson({ a: { x: 2, y: 1 } })
    );
  });

  it("hashArguments is order-insensitive", () => {
    expect(hashArguments({ b: 1, a: 2 })).toBe(hashArguments({ a: 2, b: 1 }));
  });

  it("issueApprovalToken stores a hash, not the raw token", async () => {
    const { issueApprovalToken } = await import("./approval-token");
    const result = await issueApprovalToken({
      userId: "u1",
      conversationId: "c1",
      toolId: "project_files.delete",
      argumentsHash: hashArguments({ projectId: "p1" }),
      requestId: "exec-1",
    });
    expect(result.token).toContain(".");
    expect(getRows()[0].tokenHash).not.toContain(result.token.split(".")[1]);
  });

  it("consumeApprovalToken accepts matching arguments and marks consumed", async () => {
    const { issueApprovalToken, consumeApprovalToken } = await import(
      "./approval-token"
    );
    const args = { projectId: "p1", fileId: "f1" };
    const issued = await issueApprovalToken({
      userId: "u1",
      conversationId: "c1",
      toolId: "project_files.delete",
      argumentsHash: hashArguments(args),
      requestId: "exec-2",
    });
    const result = await consumeApprovalToken(issued.token, args);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requestId).toBe("exec-2");
    expect(getRows()[0].consumedAt).not.toBeNull();
  });

  it("consumeApprovalToken rejects when arguments change (model swap)", async () => {
    const { issueApprovalToken, consumeApprovalToken } = await import(
      "./approval-token"
    );
    const original = { projectId: "p1", fileId: "f1" };
    const malicious = { projectId: "p1", fileId: "OTHER_FILE" };
    const issued = await issueApprovalToken({
      userId: "u1",
      conversationId: "c1",
      toolId: "project_files.delete",
      argumentsHash: hashArguments(original),
      requestId: "exec-3",
    });
    const result = await consumeApprovalToken(issued.token, malicious);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ARGUMENTS_CHANGED");
  });

  it("consumeApprovalToken rejects already-consumed tokens", async () => {
    const { issueApprovalToken, consumeApprovalToken } = await import(
      "./approval-token"
    );
    const args = { projectId: "p1" };
    const issued = await issueApprovalToken({
      userId: "u1",
      conversationId: "c1",
      toolId: "project_files.delete",
      argumentsHash: hashArguments(args),
      requestId: "exec-4",
    });
    await consumeApprovalToken(issued.token, args);
    const second = await consumeApprovalToken(issued.token, args);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("ALREADY_CONSUMED");
  });

  it("consumeApprovalToken rejects expired tokens", async () => {
    const { issueApprovalToken, consumeApprovalToken } = await import(
      "./approval-token"
    );
    const args = { projectId: "p1" };
    const issued = await issueApprovalToken({
      userId: "u1",
      conversationId: "c1",
      toolId: "project_files.delete",
      argumentsHash: hashArguments(args),
      requestId: "exec-5",
    });
    // Manually backdate expiry
    getRows()[0].expiresAt = new Date(Date.now() - 1000);
    const result = await consumeApprovalToken(issued.token, args);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("EXPIRED");
  });

  it("consumeApprovalToken rejects forged tokens", async () => {
    const { consumeApprovalToken } = await import("./approval-token");
    const result = await consumeApprovalToken("madeup.zzz", { projectId: "p1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });

  it("consumeApprovalToken rejects malformed tokens", async () => {
    const { consumeApprovalToken } = await import("./approval-token");
    const result = await consumeApprovalToken("no-dot", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MALFORMED");
  });

  it("returns requestId so caller can verify executionId binding", async () => {
    const { issueApprovalToken, consumeApprovalToken } = await import(
      "./approval-token"
    );
    const args = { projectId: "p1" };
    const issued = await issueApprovalToken({
      userId: "u1",
      conversationId: "c1",
      toolId: "project_files.delete",
      argumentsHash: hashArguments(args),
      requestId: "exec-bound",
    });
    const result = await consumeApprovalToken(issued.token, args);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requestId).toBe("exec-bound");
  });
});