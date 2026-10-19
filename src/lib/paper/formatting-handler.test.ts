// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ $transaction: vi.fn(), paperFormattingTask: { findFirst: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/agent/runtime", () => ({ runAgentRuntime: vi.fn() }));
vi.mock("@/lib/storage/object-storage", () => ({ readStoredObject: vi.fn(), uploadObjectBuffer: vi.fn() }));
vi.mock("@/lib/notifications/projection", () => ({ upsertTaskNotification: vi.fn() }));
vi.mock("@/lib/data/provider-access", () => ({ getProviderApiKey: vi.fn() }));
vi.mock("@/lib/paper/formatting-import", () => ({ parseFormattingSource: vi.fn(), formattingSourceHash: vi.fn() }));

import { withFormattingFence } from "./formatting-handler";
import { formattingCheckpoint } from "./formatting-service";
import { LeaseLostDuringRun } from "@/lib/agent/executions/agent-execution-runner";

function context() {
  return { execution: { id: "exec-1", userId: "user-1", leaseOwner: "worker-1", attempt: 2 }, signal: new AbortController().signal } as unknown as Parameters<typeof withFormattingFence>[0];
}

describe("formatting fence", () => {
  it("uses matching DeepSeek model and provider in new formatting checkpoints", () => {
    const checkpoint = formattingCheckpoint("task-1");
    expect(checkpoint.model).toMatchObject({ provider: "deepseek", name: "deepseek-flash" });
    expect(checkpoint.request?.model).toBe("deepseek-flash");
  });
  it("binds the lease instant instead of relying on the database session time zone", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: "exec-1" }]);
    const findFirst = vi.fn().mockResolvedValue({ id: "task-1" });
    const update = vi.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: queryRaw, paperFormattingTask: { findFirst, update } }));

    await withFormattingFence(context(), "task-1", async (tx) => { await tx.paperFormattingTask.update({ where: { id: "task-1" }, data: { status: "importing" } }); });

    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?").replace(/\s+/g, " ")).toContain(`"leaseExpiresAt" > ?`);
    expect(strings.join(" ")).not.toContain("NOW()");
    expect(values.at(-1)).toBeInstanceOf(Date);
    expect(update).toHaveBeenCalled();
  });

  it("fails the fence when the lease no longer matches", async () => {
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: vi.fn().mockResolvedValue([]), paperFormattingTask: { findFirst: vi.fn(), update: vi.fn() } }));
    await expect(withFormattingFence(context(), "task-1", async () => "never")).rejects.toBeInstanceOf(LeaseLostDuringRun);
  });
});
