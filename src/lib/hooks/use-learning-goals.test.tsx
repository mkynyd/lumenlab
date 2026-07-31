import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/api/client";
import {
  fixtureGoal,
  fixtureKnowledgeMap,
  fixtureScopeDraft,
} from "@/components/learning/__fixtures__/learning-fixtures";
import { learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import type { SaveScopeDraftInput } from "@/lib/hooks/use-learning-api";
import {
  useConfirmScope,
  useCreateLearningGoal,
  useGenerateKnowledgeMap,
  useKnowledgeMap,
  useLearningGoals,
  useLearningScope,
  useSaveScopeDraft,
  useUpdateLearningGoalStatus,
} from "@/lib/hooks/use-learning-goals";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...original, fetchJson: vi.fn() };
});

const fetchJsonMock = vi.mocked(fetchJson);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

function lastRequest() {
  const call = fetchJsonMock.mock.calls.at(-1);
  if (!call) throw new Error("fetchJson was not called");
  const [url, init] = call;
  const body =
    typeof init?.body === "string"
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : undefined;
  return { url: String(url), init, body };
}

beforeEach(() => {
  fetchJsonMock.mockReset();
});

describe("useLearningGoals", () => {
  it("fetches the project goals and unwraps the list", async () => {
    fetchJsonMock.mockResolvedValue({ goals: [fixtureGoal] } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useLearningGoals("project-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([fixtureGoal]);
    const { url, init } = lastRequest();
    expect(url).toBe(learningUrls.goals("project-1"));
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("does not fetch without a project id", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useLearningGoals(undefined), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("useCreateLearningGoal", () => {
  it("posts the goal with activate defaulting to true and reuses the idempotency key", async () => {
    fetchJsonMock.mockResolvedValue({ goal: fixtureGoal } as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(learningKeys.goals("project-1"), [fixtureGoal]);

    const { result } = renderHook(() => useCreateLearningGoal("project-1"), { wrapper });
    await result.current.mutateAsync({
      title: "数据结构期末复习",
      purpose: "两周后期末考试",
      idempotencyKey: "idem-create-1",
    });

    const { url, init, body } = lastRequest();
    expect(url).toBe(learningUrls.goals("project-1"));
    expect(init?.method).toBe("POST");
    expect(body).toMatchObject({
      title: "数据结构期末复习",
      purpose: "两周后期末考试",
      activate: true,
      idempotencyKey: "idem-create-1",
    });
    expect(
      queryClient.getQueryState(learningKeys.goals("project-1"))?.isInvalidated
    ).toBe(true);
  });

  it("generates an idempotency key when omitted and respects activate: false", async () => {
    fetchJsonMock.mockResolvedValue({ goal: fixtureGoal } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateLearningGoal("project-1"), { wrapper });
    await result.current.mutateAsync({ title: "只建草稿", activate: false });

    const { body } = lastRequest();
    expect(body?.activate).toBe(false);
    expect(typeof body?.idempotencyKey).toBe("string");
    expect((body?.idempotencyKey as string).length).toBeGreaterThan(0);
  });
});

describe("useUpdateLearningGoalStatus", () => {
  it("patches the goal status and invalidates the goals list", async () => {
    fetchJsonMock.mockResolvedValue({ goal: fixtureGoal } as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(learningKeys.goals("project-1"), [fixtureGoal]);

    const { result } = renderHook(
      () => useUpdateLearningGoalStatus("project-1", "goal-1"),
      { wrapper }
    );
    await result.current.mutateAsync({ status: "paused", idempotencyKey: "idem-status-1" });

    const { url, init, body } = lastRequest();
    expect(url).toBe(learningUrls.goal("project-1", "goal-1"));
    expect(init?.method).toBe("PATCH");
    expect(body).toEqual({ status: "paused", idempotencyKey: "idem-status-1" });
    expect(
      queryClient.getQueryState(learningKeys.goals("project-1"))?.isInvalidated
    ).toBe(true);
  });
});

describe("useLearningScope", () => {
  it("fetches the scope and unwraps it", async () => {
    fetchJsonMock.mockResolvedValue({ scope: fixtureScopeDraft } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useLearningScope("project-1", "goal-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fixtureScopeDraft);
    expect(lastRequest().url).toBe(learningUrls.scope("project-1", "goal-1"));
  });

  it("passes a null scope through", async () => {
    fetchJsonMock.mockResolvedValue({ scope: null } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useLearningScope("project-1", "goal-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not fetch without both ids", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useLearningScope(undefined, "goal-1"), { wrapper });
    renderHook(() => useLearningScope("project-1", undefined), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("useSaveScopeDraft", () => {
  it("puts a replace_draft command and invalidates the scope", async () => {
    fetchJsonMock.mockResolvedValue({ scope: fixtureScopeDraft } as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(learningKeys.scope("project-1", "goal-1"), fixtureScopeDraft);

    const input: SaveScopeDraftInput = {
      expectedVersion: 1,
      definition: { focus: "树与图" },
      materialMode: "project_corpus",
      fileIds: [],
      materialGaps: ["缺少第 7 章讲义"],
    };

    const { result } = renderHook(() => useSaveScopeDraft("project-1", "goal-1"), { wrapper });
    await result.current.mutateAsync({ ...input, idempotencyKey: "idem-draft-1" });

    const { url, init, body } = lastRequest();
    expect(url).toBe(learningUrls.scope("project-1", "goal-1"));
    expect(init?.method).toBe("PUT");
    expect(body).toEqual({ command: "replace_draft", ...input, idempotencyKey: "idem-draft-1" });
    expect(
      queryClient.getQueryState(learningKeys.scope("project-1", "goal-1"))?.isInvalidated
    ).toBe(true);
  });
});

describe("useConfirmScope", () => {
  it("puts a confirm command with the expected version", async () => {
    fetchJsonMock.mockResolvedValue({ scope: fixtureScopeDraft } as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(learningKeys.scope("project-1", "goal-1"), fixtureScopeDraft);

    const { result } = renderHook(() => useConfirmScope("project-1", "goal-1"), { wrapper });
    await result.current.mutateAsync({ expectedVersion: 1, idempotencyKey: "idem-confirm-1" });

    const { url, init, body } = lastRequest();
    expect(url).toBe(learningUrls.scope("project-1", "goal-1"));
    expect(init?.method).toBe("PUT");
    expect(body).toEqual({
      command: "confirm",
      expectedVersion: 1,
      idempotencyKey: "idem-confirm-1",
    });
    expect(
      queryClient.getQueryState(learningKeys.scope("project-1", "goal-1"))?.isInvalidated
    ).toBe(true);
  });
});

describe("useKnowledgeMap", () => {
  it("fetches the knowledge map and unwraps it", async () => {
    fetchJsonMock.mockResolvedValue({ map: fixtureKnowledgeMap } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useKnowledgeMap("project-1", "goal-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fixtureKnowledgeMap);
    expect(lastRequest().url).toBe(learningUrls.map("project-1", "goal-1"));
  });

  it("does not fetch without both ids", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useKnowledgeMap("project-1", undefined), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("useGenerateKnowledgeMap", () => {
  it("posts generation and caches the map without touching the scope", async () => {
    fetchJsonMock.mockResolvedValue({ map: fixtureKnowledgeMap } as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(learningKeys.scope("project-1", "goal-1"), fixtureScopeDraft);

    const { result } = renderHook(
      () => useGenerateKnowledgeMap("project-1", "goal-1"),
      { wrapper }
    );
    await result.current.mutateAsync({ idempotencyKey: "idem-map-1" });

    const { url, init, body } = lastRequest();
    expect(url).toBe(learningUrls.map("project-1", "goal-1"));
    expect(init?.method).toBe("POST");
    expect(body).toEqual({ idempotencyKey: "idem-map-1" });
    expect(queryClient.getQueryData(learningKeys.map("project-1", "goal-1"))).toEqual(
      fixtureKnowledgeMap
    );
    expect(
      queryClient.getQueryState(learningKeys.scope("project-1", "goal-1"))?.isInvalidated
    ).toBe(false);
  });
});
