export type AgentExecutionRetryDecision =
  | {
      action: "retry";
      delayMs: number;
      scheduledAt: Date;
    }
  | { action: "fail" };

export type AgentExecutionRetryPolicyOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertPositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

export class AgentExecutionRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;

  constructor(options: AgentExecutionRetryPolicyOptions) {
    assertPositiveInteger(options.maxAttempts, "maxAttempts");
    assertPositiveFinite(options.baseDelayMs, "baseDelayMs");
    assertPositiveFinite(options.maxDelayMs, "maxDelayMs");
    if (options.maxDelayMs < options.baseDelayMs) {
      throw new Error("maxDelayMs must be greater than or equal to baseDelayMs");
    }

    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
    this.maxDelayMs = options.maxDelayMs;
  }

  decide(input: {
    attempt: number;
    now: Date;
  }): AgentExecutionRetryDecision {
    assertPositiveInteger(input.attempt, "attempt");
    if (input.attempt >= this.maxAttempts) {
      return { action: "fail" };
    }

    const exponent = Math.max(0, input.attempt - 1);
    const delayMs = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** exponent
    );
    return {
      action: "retry",
      delayMs,
      scheduledAt: new Date(input.now.getTime() + delayMs),
    };
  }
}
