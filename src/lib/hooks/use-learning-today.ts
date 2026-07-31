"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import type { LearningTodayResponse } from "@/lib/hooks/use-learning-api";

export function useLearningToday(enabled = true) {
  return useQuery({
    queryKey: learningKeys.today(),
    queryFn: () => fetchJson<LearningTodayResponse>(learningUrls.today()),
    enabled,
  });
}
