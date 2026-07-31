import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/api/client";
import {
  fixtureProgressResponse,
  fixtureReviewList,
  fixtureSession,
  fixtureWrongAnswerList,
} from "@/components/learning/__fixtures__/learning-fixtures";
import { learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import {
  useCreateReviewSession,
  useLearningProgress,
  useReviewQueue,
  useWrongAnswers,
} from "@/lib/hooks/use-learning-progress";

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

describe("useLearningProgress", () => {
  it("fetches the progress and unwraps it", async () => {
    fetchJsonMock.mockResolvedValue(fixtureProgressResponse as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useLearningProgress("project-1", "goal-1"),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fixtureProgressResponse);
    expect(lastRequest().url).toBe(learningUrls.progress("project-1", "goal-1"));
  });

  it("does not fetch without both ids", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useLearningProgress(undefined, "goal-1"), { wrapper });
    renderHook(() => useLearningProgress("project-1", undefined), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("useWrongAnswers", () => {
  it("fetches the wrong-answer list and unwraps the entries", async () => {
    fetchJsonMock.mockResolvedValue(fixtureWrongAnswerList as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWrongAnswers("project-1", "goal-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fixtureWrongAnswerList.items);
    expect(lastRequest().url).toBe(learningUrls.wrongAnswers("project-1", "goal-1"));
  });

  it("does not fetch without both ids", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useWrongAnswers("project-1", undefined), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("useReviewQueue", () => {
  it("fetches the review queue and unwraps the entries", async () => {
    fetchJsonMock.mockResolvedValue(fixtureReviewList as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useReviewQueue("project-1", "goal-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fixtureReviewList.reviews);
    expect(lastRequest().url).toBe(learningUrls.reviews("project-1", "goal-1"));
  });

  it("does not fetch without both ids", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useReviewQueue(undefined, "goal-1"), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("useCreateReviewSession", () => {
  it("posts to the reviews route with limit and invalidates the queue", async () => {
    fetchJsonMock.mockResolvedValue({ session: fixtureSession } as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(
      learningKeys.reviews("project-1", "goal-1"),
      fixtureReviewList.reviews
    );

    const { result } = renderHook(
      () => useCreateReviewSession("project-1", "goal-1"),
      { wrapper }
    );
    const session = await result.current.mutateAsync({
      limit: 10,
      idempotencyKey: "idem-review-1",
    });

    expect(session).toEqual({ session: fixtureSession });
    const { url, init, body } = lastRequest();
    expect(url).toBe(learningUrls.reviews("project-1", "goal-1"));
    expect(init?.method).toBe("POST");
    expect(body).toEqual({ idempotencyKey: "idem-review-1", limit: 10 });
    expect(
      queryClient.getQueryState(learningKeys.reviews("project-1", "goal-1"))
        ?.isInvalidated
    ).toBe(true);
  });

  it("omits the limit when not provided", async () => {
    fetchJsonMock.mockResolvedValue({ session: fixtureSession } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useCreateReviewSession("project-1", "goal-1"),
      { wrapper }
    );
    await result.current.mutateAsync({ idempotencyKey: "idem-review-2" });

    const { body } = lastRequest();
    expect(body).toEqual({ idempotencyKey: "idem-review-2" });
    expect(body).not.toHaveProperty("limit");
  });
});
