export interface TokenUsageDisplayFields {
  totalTokens?: number | null;
  tokenCount?: number | null;
  inputCacheHitTokens?: number | null;
  inputCacheMissTokens?: number | null;
  outputTokens?: number | null;
}

export function getDisplayTotalTokens(row: TokenUsageDisplayFields) {
  const recordedTotal = row.totalTokens ?? row.tokenCount ?? 0;
  const componentTotal =
    (row.inputCacheHitTokens ?? 0) +
    (row.inputCacheMissTokens ?? 0) +
    (row.outputTokens ?? 0);

  return Math.max(recordedTotal, componentTotal);
}
