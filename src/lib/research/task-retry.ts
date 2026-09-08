export type ResearchTaskRetryStatus = "retrying" | "failed";

export function nextResearchTaskRetryStatus(attempt: number, maxAttempts: number): ResearchTaskRetryStatus {
  return attempt < maxAttempts ? "retrying" : "failed";
}
