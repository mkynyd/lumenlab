import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/api/client";
import { learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import {
  useCorrectLearningErrorType,
  useLearningHistory,
} from "@/lib/hooks/use-learning-history";

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
  return {
    url: String(url),
    init,
    body:
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined,
  };
}

beforeEach(() => {
  fetchJsonMock.mockReset();
});

describe("useLearningHistory", () => {
  it("fetches and unwraps the evidence-backed history", async () => {
    const history = {
      goal: { id: "goal-1", title: "复习电路" },
      summary: { attempts: 1 },
      points: [],
    };
    fetchJsonMock.mockResolvedValue({ history } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useLearningHistory("project-1", "goal-1"),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(history);
    expect(lastRequest().url).toBe(
      learningUrls.history("project-1", "goal-1")
    );
  });

  it("does not fetch until both ownership ids are available", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useLearningHistory(undefined, "goal-1"), { wrapper });
    renderHook(() => useLearningHistory("project-1", undefined), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
describe("useCorrectLearningErrorType", () => {
  it("posts an idempotent correction and invalidates history and wrong answers", async () => {
    fetchJsonMock.mockResolvedValue({
      correction: {
        id: "correction-1",
        evaluationId: "evaluation-1",
        errorType: "misconception",
      },
    } as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(
      learningKeys.history("project-1", "goal-1"),
      { points: [] }
    );
    queryClient.setQueryData(
      learningKeys.wrongAnswers("project-1", "goal-1"),
      []
    );

    const { result } = renderHook(
      () => useCorrectLearningErrorType("project-1", "goal-1"),
      { wrapper }
    );
    await result.current.mutateAsync({
      evaluationId: "evaluation-1",
      errorType: "misconception",
      reason: "概念混淆",
      idempotencyKey: "correction-key",
    });

    const { url, init, body } = lastRequest();
    expect(url).toBe(
      learningUrls.errorTypeCorrections(
        "project-1",
        "goal-1",
        "evaluation-1"
      )
    );
    expect(init?.method).toBe("POST");
    expect(body).toEqual({
      errorType: "misconception",
      reason: "概念混淆",
      idempotencyKey: "correction-key",
    });
    expect(
      queryClient.getQueryState(
        learningKeys.history("project-1", "goal-1")
      )?.isInvalidated
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        learningKeys.wrongAnswers("project-1", "goal-1")
      )?.isInvalidated
    ).toBe(true);
  });
});
