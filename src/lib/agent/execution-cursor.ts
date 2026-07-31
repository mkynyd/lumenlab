type CursorInput = {
  lastEventId: string | null;
  afterSequence: string | null;
};

function parseCursorValue(value: string, field: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${field} exceeds the supported sequence range`);
  }
  return parsed;
}

export function parseExecutionCursor(input: CursorInput): number {
  const header =
    input.lastEventId === null
      ? null
      : parseCursorValue(input.lastEventId, "Last-Event-ID");
  const query =
    input.afterSequence === null
      ? null
      : parseCursorValue(input.afterSequence, "afterSequence");

  if (header !== null && query !== null && header !== query) {
    throw new Error("Last-Event-ID and afterSequence must match");
  }
  return query ?? header ?? 0;
}

export class ExecutionSequenceCursor {
  private current: number;

  constructor(
    private readonly agentExecutionId: string,
    initialSequence = 0
  ) {
    if (!agentExecutionId.trim()) {
      throw new Error("agentExecutionId must not be empty");
    }
    if (!Number.isSafeInteger(initialSequence) || initialSequence < 0) {
      throw new Error("initialSequence must be a non-negative integer");
    }
    this.current = initialSequence;
  }

  get sequence(): number {
    return this.current;
  }

  accept(event: { agentExecutionId: string; sequence: number }): boolean {
    if (event.agentExecutionId !== this.agentExecutionId) {
      throw new Error("Durable event belongs to a different AgentExecution");
    }
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0) {
      throw new Error("Durable event sequence must be a positive integer");
    }
    if (event.sequence <= this.current) return false;
    this.current = event.sequence;
    return true;
  }
}
