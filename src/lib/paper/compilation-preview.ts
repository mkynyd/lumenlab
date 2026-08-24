export interface CompilationPreviewCandidate {
  id: string;
  status: string;
  pdfStorageProvider?: string | null;
  pdfObjectKey?: string | null;
  syncTex?: unknown;
}

export interface CompilationPreviewSyncTex {
  provider?: string;
  key?: string;
  format?: string;
}

export interface CompilationPreviewSelection {
  pdfCompilationId: string | null;
  syncTex: CompilationPreviewSyncTex | null;
}

function normalizeSyncTex(value: unknown): CompilationPreviewSyncTex | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.provider === "string" ? { provider: record.provider } : {}),
    ...(typeof record.key === "string" ? { key: record.key } : {}),
    ...(typeof record.format === "string" ? { format: record.format } : {}),
  };
}

function hasSuccessfulPdf(candidate: CompilationPreviewCandidate | null | undefined): candidate is CompilationPreviewCandidate {
  return Boolean(
    candidate?.status === "succeeded" &&
      candidate.pdfStorageProvider &&
      candidate.pdfObjectKey
  );
}

/**
 * Keep the last successful artifact visible while a newer compilation is
 * queued, running, or failed. The newest successful candidate wins when it
 * is available; the latest job is only a status source, never a blank-PDF
 * replacement.
 */
export function selectCompilationPreview(
  latest: CompilationPreviewCandidate | null | undefined,
  lastSuccessful: CompilationPreviewCandidate | null | undefined
): CompilationPreviewSelection {
  const source = hasSuccessfulPdf(lastSuccessful)
    ? lastSuccessful
    : hasSuccessfulPdf(latest)
      ? latest
      : null;
  return {
    pdfCompilationId: source?.id ?? null,
    syncTex: normalizeSyncTex(source?.syncTex),
  };
}
