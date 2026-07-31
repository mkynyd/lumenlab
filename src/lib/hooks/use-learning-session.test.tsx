import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/api/client";
import {
  fixtureAnswerExposure,
  fixtureAttemptResult,
  fixtureHintResult,
  fixtureSession,
} from "@/components/learning/__fixtures__/learning-fixtures";
import { learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import {
  useCreateDiagnosticSession,
  useLearningSession,
  useRecordAnswerExposure,
  useRecordHint,
  useSubmitAttempt,
} from "@/lib/hooks/use-learning-session";

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

describe("useLearningSession", () => {
  it("fetches the session and unwraps it", async () => {
    fetchJsonMock.mockResolvedValue({ session: fixtureSession } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useLearningSession("project-1", "session-1"),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fixtureSession);
    const { url, init } = lastRequest();
    expect(url).toBe(learningUrls.session("project-1", "session-1"));
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("does not fetch without both ids", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useLearningSession(undefined, "session-1"), { wrapper });
    renderHook(() => useLearningSession("project-1", undefined), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("useCreateDiagnosticSession", () => {
  it("posts to the diagnostics route with an idempotency key", async () => {
    fetchJsonMock.mockResolvedValue({ session: fixtureSession } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useCreateDiagnosticSession("project-1", "goal-1"),
      { wrapper }
    );
    const session = await result.current.mutateAsync({ idempotencyKey: "idem-diag-1" });

    expect(session).toEqual({ session: fixtureSession });
    const { url, init, body } = lastRequest();
    expect(url).toBe(learningUrls.diagnostics("project-1", "goal-1"));
    expect(init?.method).toBe("POST");
    expect(body).toEqual({ idempotencyKey: "idem-diag-1" });
  });

  it("generates an idempotency key when omitted", async () => {
    fetchJsonMock.mockResolvedValue({ session: fixtureSession } as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useCreateDiagnosticSession("project-1", "goal-1"),
      { wrapper }
    );
    await result.current.mutateAsync({});

    const { body } = lastRequest();
    expect(typeof body?.idempotencyKey).toBe("string");
    expect((body?.idempotencyKey as string).length).toBeGreaterThan(0);
  });
});

describe("useRecordHint", () => {
  it("posts to the hint route for the session item", async () => {
    const hintResult = { ...fixtureHintResult, hint: "先想左子树。" };
    fetchJsonMock.mockResolvedValue(hintResult as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useRecordHint("project-1", "session-1"), { wrapper });
    const data = await result.current.mutateAsync({
      sessionItemId: "session-item-1",
      idempotencyKey: "idem-hint-1",
    });

    expect(data).toEqual(hintResult);
    const { url, init, body } = lastRequest();
    expect(url).toBe(
      learningUrls.sessionItemHint("project-1", "session-1", "session-item-1")
    );
    expect(init?.method).toBe("POST");
    expect(body).toEqual({ idempotencyKey: "idem-hint-1" });
  });
});

describe("useRecordAnswerExposure", () => {
  it("posts to the answer route for the session item", async () => {
    const exposureResult = fixtureAnswerExposure;
    fetchJsonMock.mockResolvedValue(exposureResult as never);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useRecordAnswerExposure("project-1", "session-1"),
      { wrapper }
    );
    const data = await result.current.mutateAsync({
      sessionItemId: "session-item-1",
      idempotencyKey: "idem-answer-1",
    });

    expect(data).toEqual(exposureResult);
    const { url, init, body } = lastRequest();
    expect(url).toBe(
      learningUrls.sessionItemAnswer("project-1", "session-1", "session-item-1")
    );
    expect(init?.method).toBe("POST");
    expect(body).toEqual({ idempotencyKey: "idem-answer-1" });
  });
});

describe("useSubmitAttempt", () => {
  it("submits only idempotencyKey and answer, never client-side evaluation fields", async () => {
    fetchJsonMock.mockResolvedValue(fixtureAttemptResult as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(
      learningKeys.session("project-1", "session-1"),
      fixtureSession
    );

    const { result } = renderHook(
      () => useSubmitAttempt("project-1", "session-1"),
      { wrapper }
    );
    const data = await result.current.mutateAsync({
      sessionItemId: "session-item-1",
      answer: "opt-a",
      idempotencyKey: "idem-attempt-1",
    });

    expect(data).toEqual(fixtureAttemptResult);
    const { url, init, body } = lastRequest();
    expect(url).toBe(
      learningUrls.sessionItemAttempts("project-1", "session-1", "session-item-1")
    );
    expect(init?.method).toBe("POST");
    expect(body).toEqual({ idempotencyKey: "idem-attempt-1", answer: "opt-a" });
    for (const forbidden of [
      "score",
      "verdict",
      "mastery",
      "assistanceLevel",
      "spacing",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
    expect(
      queryClient.getQueryState(learningKeys.session("project-1", "session-1"))
        ?.isInvalidated
    ).toBe(true);
  });

  it("invalidates progress, wrong-answers, reviews and today when goalId is given", async () => {
    fetchJsonMock.mockResolvedValue(fixtureAttemptResult as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(learningKeys.progress("project-1", "goal-1"), {});
    queryClient.setQueryData(learningKeys.wrongAnswers("project-1", "goal-1"), []);
    queryClient.setQueryData(learningKeys.reviews("project-1", "goal-1"), []);
    queryClient.setQueryData(learningKeys.today(), {});

    const { result } = renderHook(
      () => useSubmitAttempt("project-1", "session-1"),
      { wrapper }
    );
    await result.current.mutateAsync({
      sessionItemId: "session-item-1",
      answer: ["opt-a", "opt-b"],
      goalId: "goal-1",
      idempotencyKey: "idem-attempt-2",
    });

    expect(
      queryClient.getQueryState(learningKeys.progress("project-1", "goal-1"))
        ?.isInvalidated
    ).toBe(true);
    expect(
      queryClient.getQueryState(learningKeys.wrongAnswers("project-1", "goal-1"))
        ?.isInvalidated
    ).toBe(true);
    expect(
      queryClient.getQueryState(learningKeys.reviews("project-1", "goal-1"))
        ?.isInvalidated
    ).toBe(true);
    expect(queryClient.getQueryState(learningKeys.today())?.isInvalidated).toBe(true);
  });

  it("does not touch progress or today without a goalId", async () => {
    fetchJsonMock.mockResolvedValue(fixtureAttemptResult as never);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(learningKeys.progress("project-1", "goal-1"), {});
    queryClient.setQueryData(learningKeys.today(), {});

    const { result } = renderHook(
      () => useSubmitAttempt("project-1", "session-1"),
      { wrapper }
    );
    await result.current.mutateAsync({
      sessionItemId: "session-item-1",
      answer: 42,
      idempotencyKey: "idem-attempt-3",
    });

    expect(
      queryClient.getQueryState(learningKeys.progress("project-1", "goal-1"))
        ?.isInvalidated
    ).toBe(false);
    expect(queryClient.getQueryState(learningKeys.today())?.isInvalidated).toBe(false);
  });
});
