/**
 * Sciverse transport error model.
 *
 * Sciverse is the platform's dedicated academic retrieval and scientific
 * evidence source. Failures surface as a typed error so the handler layer can
 * map each kind to a stable `{ error: "SCIVERSE_*" }` result instead of
 * throwing through the Tool Executor.
 */

export type SciverseErrorKind =
  | "request"
  | "auth"
  | "not_found"
  | "rate_limit"
  | "server"
  | "network"
  | "response";

export class SciverseError extends Error {
  constructor(
    readonly kind: SciverseErrorKind,
    readonly status: number | null,
    message: string,
    readonly code?: string,
    readonly requestId?: string,
    readonly retryAfterMs?: number | null
  ) {
    super(message);
    this.name = "SciverseError";
  }
}
