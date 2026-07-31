import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/api/client";
import { fixtureToday } from "@/components/learning/__fixtures__/learning-fixtures";
import { learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import { useLearningToday } from "@/lib/hooks/use-learning-today";

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

beforeEach(() => {
  fetchJsonMock.mockReset();
});

describe("useLearningToday", () => {
  it("fetches the today payload and returns it unwrapped", async () => {
    fetchJsonMock.mockResolvedValue(fixtureToday as never);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(() => useLearningToday(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fixtureToday);
    const call = fetchJsonMock.mock.calls.at(-1);
    expect(String(call?.[0])).toBe(learningUrls.today());
    expect(queryClient.getQueryData(learningKeys.today())).toEqual(fixtureToday);
  });

  it("does not fetch when disabled", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useLearningToday(false), { wrapper });
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
