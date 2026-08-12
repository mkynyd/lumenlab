import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminObservabilitySignature } from "@/lib/admin-observability-auth";

const mocks = vi.hoisted(() => ({
  nonceDelete: vi.fn(),
  nonceCreate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  overview: vi.fn(),
  users: vi.fn(),
  user: vi.fn(),
  conversations: vi.fn(),
  messages: vi.fn(),
  tools: vi.fn(),
  feedback: vi.fn(),
  errors: vi.fn(),
  updateFeedback: vi.fn(),
  updateError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    adminObservabilityNonce: {
      deleteMany: mocks.nonceDelete,
      create: mocks.nonceCreate,
    },
    adminObservabilityAudit: { create: mocks.auditCreate },
  },
}));
vi.mock("@/lib/admin-observability-service", () => ({
  getAdminOverview: mocks.overview,
  listAdminUsers: mocks.users,
  getAdminUserDetail: mocks.user,
  listAdminConversations: mocks.conversations,
  listAdminMessages: mocks.messages,
  getAdminToolUsage: mocks.tools,
  listAdminFeedback: mocks.feedback,
  listAdminErrors: mocks.errors,
  updateAdminFeedbackStatus: mocks.updateFeedback,
  updateAdminErrorStatus: mocks.updateError,
}));

import { GET, PATCH } from "./route";

const secret = "observability-secret-for-tests";

function signedRequest(url: string, method = "GET", body = "") {
  const timestamp = String(Date.now());
  const nonce = `nonce_${Math.random().toString(36).slice(2)}_1234567890123456`;
  const parsed = new URL(url);
  const signature = adminObservabilitySignature({
    method,
    path: `${parsed.pathname}${parsed.search}`,
    body,
    timestamp,
    nonce,
    secret,
  });
  return new NextRequest(url, {
    method,
    body: body || undefined,
    headers: {
      "x-admin-timestamp": timestamp,
      "x-admin-nonce": nonce,
      "x-admin-signature": signature,
    },
  });
}

describe("internal admin observability route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_OBSERVABILITY_SECRET", secret);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        adminObservabilityNonce: {
          deleteMany: mocks.nonceDelete,
          create: mocks.nonceCreate,
        },
      })
    );
    mocks.auditCreate.mockResolvedValue({});
    mocks.overview.mockResolvedValue({ metrics: { totalUsers: 6 } });
  });

  it("hides the endpoint when the signature is missing", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/internal/admin-observability?action=overview")
    );
    expect(response.status).toBe(404);
  });

  it("returns overview and records a content-free audit entry", async () => {
    const url = "http://localhost/api/internal/admin-observability?action=overview";
    const response = await GET(signedRequest(url));
    expect(response.status).toBe(200);
    expect((await response.json()).data.metrics.totalUsers).toBe(6);
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "admin.observe.overview" }),
      })
    );
  });

  it("only returns public user/assistant messages through the service seam", async () => {
    mocks.messages.mockResolvedValue({
      conversation: { id: "c1" },
      items: [{ id: "m1", role: "user", content: "hello" }],
      nextCursor: null,
    });
    const url =
      "http://localhost/api/internal/admin-observability?action=messages&conversationId=c1";
    const response = await GET(signedRequest(url));
    expect(response.status).toBe(200);
    expect(mocks.messages).toHaveBeenCalled();
  });

  it("allows only bounded feedback status mutations", async () => {
    mocks.updateFeedback.mockResolvedValue({ id: "f1", status: "resolved" });
    const body = JSON.stringify({
      action: "feedback.status",
      id: "f1",
      status: "resolved",
    });
    const url = "http://localhost/api/internal/admin-observability";
    const response = await PATCH(signedRequest(url, "PATCH", body));
    expect(response.status).toBe(200);
    expect(mocks.updateFeedback).toHaveBeenCalledWith("f1", "resolved");
  });
});
