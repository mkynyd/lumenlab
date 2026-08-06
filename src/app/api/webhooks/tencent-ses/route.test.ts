import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { emailLogEvent, emailLog } = vi.hoisted(() => ({
  emailLogEvent: {
    createMany: vi.fn(),
    updateMany: vi.fn(),
  },
  emailLog: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: { emailLogEvent, emailLog } }));

import { GET, POST } from "./route";

const DELIVERED_PAYLOAD = {
  event: "delivered",
  email: "user@example.com",
  bulkId: "qcloudses-30-251200670-date-20260806-8jolHvR2XcXC1",
  timestamp: 1654064683,
  messageId: "ea2783c1-7704-48a8-af36-2b9e83e767ec@fromexample.com",
};

const HARD_BOUNCE_PAYLOAD = {
  ...DELIVERED_PAYLOAD,
  event: "bounce",
  bounceType: "hard_bounce",
  reason: "551 5.1.1 recipient is not exist",
};

function makePost(body: unknown) {
  return new NextRequest("http://localhost/api/webhooks/tencent-ses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/tencent-ses", () => {
  beforeEach(() => {
    emailLogEvent.createMany.mockReset().mockResolvedValue({ count: 1 });
    emailLogEvent.updateMany.mockReset().mockResolvedValue({ count: 1 });
    emailLog.findFirst.mockReset().mockResolvedValue(null);
    emailLog.update.mockReset().mockResolvedValue({});
    emailLog.create.mockReset().mockResolvedValue({ id: "log-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the event row idempotently and updates the matched EmailLog", async () => {
    emailLog.findFirst.mockResolvedValue({
      id: "log-1",
      event: "sent",
      bounceType: null,
    });

    const response = await POST(makePost(DELIVERED_PAYLOAD));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(emailLogEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          emailLogId: null,
          event: "delivered",
          payload: DELIVERED_PAYLOAD,
          payloadHash: expect.any(String),
        },
      ],
      skipDuplicates: true,
    });
    expect(emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: expect.objectContaining({
        event: "delivered",
        smtpMessageId: DELIVERED_PAYLOAD.messageId,
      }),
    });
  });

  it("replays the same payload with zero writes (payloadHash idempotency)", async () => {
    // 模拟真实行为：第一次未命中建占位行，之后 findFirst 命中占位行
    let placeholder: { id: string; event: string; bounceType: string | null } | null =
      null;
    emailLog.findFirst.mockImplementation(async () => placeholder);
    emailLog.create.mockImplementation(async () => {
      placeholder = { id: "log-1", event: "callback-only", bounceType: null };
      return placeholder;
    });
    emailLog.update.mockImplementation(async () => placeholder);
    emailLogEvent.createMany.mockResolvedValue({ count: 0 });

    const first = await POST(makePost(DELIVERED_PAYLOAD));
    const second = await POST(makePost(DELIVERED_PAYLOAD));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // 幂等：占位 EmailLog 行只创建一次
    expect(emailLog.create).toHaveBeenCalledTimes(1);
  });

  it("creates a callback-only placeholder when the bulkId is unknown", async () => {
    emailLog.findFirst.mockResolvedValue(null);

    const response = await POST(makePost(DELIVERED_PAYLOAD));

    expect(response.status).toBe(200);
    expect(emailLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "callback",
        email: "user@example.com",
        bulkId: DELIVERED_PAYLOAD.bulkId,
        event: "callback-only",
      }),
      select: { id: true },
    });
  });

  it("escalates delivered to bounced on a hard bounce", async () => {
    emailLog.findFirst.mockResolvedValue({
      id: "log-1",
      event: "delivered",
      bounceType: null,
    });

    await POST(makePost(HARD_BOUNCE_PAYLOAD));

    expect(emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: expect.objectContaining({
        event: "bounced",
        bounceType: "hard_bounce",
        reason: "551 5.1.1 recipient is not exist",
      }),
    });
  });

  it("does not downgrade a terminal bounced state on a late delivered", async () => {
    emailLog.findFirst.mockResolvedValue({
      id: "log-1",
      event: "bounced",
      bounceType: "hard_bounce",
    });

    await POST(makePost(DELIVERED_PAYLOAD));

    expect(emailLog.update).not.toHaveBeenCalled();
  });

  it("does not upgrade a delivered state on a deferred event", async () => {
    emailLog.findFirst.mockResolvedValue({
      id: "log-1",
      event: "delivered",
      bounceType: null,
    });

    await POST(makePost({ ...DELIVERED_PAYLOAD, event: "deferred" }));

    expect(emailLog.update).not.toHaveBeenCalled();
  });

  it("does not update the state machine for open/click events", async () => {
    emailLog.findFirst.mockResolvedValue({
      id: "log-1",
      event: "sent",
      bounceType: null,
    });

    await POST(makePost({ ...DELIVERED_PAYLOAD, event: "open", link: "https://x" }));

    expect(emailLog.update).not.toHaveBeenCalled();
  });

  it("answers 200 with a log for oversized or malformed bodies", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const oversized = await POST(
      new NextRequest("http://localhost/api/webhooks/tencent-ses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "100000",
        },
        body: JSON.stringify({ event: "delivered" }),
      })
    );
    expect(oversized.status).toBe(200);

    const malformed = await POST(
      new NextRequest("http://localhost/api/webhooks/tencent-ses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      })
    );
    expect(malformed.status).toBe(200);

    warnSpy.mockRestore();
  });

  it("rejects non-POST methods with 405", async () => {
    const response = await GET();

    expect(response.status).toBe(405);
  });
});
