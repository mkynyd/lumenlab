import type {
  AgentExecutionStore,
  CreateOrGetAgentExecutionInput,
  CreateOrGetAgentExecutionResult,
} from "./agent-execution-store";

type DispatchStore = Pick<
  AgentExecutionStore,
  "createOrGetByClientRunKey"
>;

export type DispatchAgentExecutionInput = CreateOrGetAgentExecutionInput;
export type DispatchAgentExecutionResult = CreateOrGetAgentExecutionResult;

/**
 * Transport-neutral durable dispatch seam.
 *
 * A caller may retry this operation after losing an HTTP/SSE connection. The
 * stable clientRunKey and requestHash are the only identities that matter;
 * request AbortSignals deliberately do not cross this boundary.
 */
export class AgentExecutionDispatcher {
  constructor(private readonly store: DispatchStore) {}

  async dispatch(
    input: DispatchAgentExecutionInput
  ): Promise<DispatchAgentExecutionResult> {
    const clientRunKey = input.clientRunKey.trim();
    if (!clientRunKey) {
      throw new Error("clientRunKey must not be empty");
    }
    const requestHash = input.requestHash.trim();
    if (!requestHash) {
      throw new Error("requestHash must not be empty");
    }

    return this.store.createOrGetByClientRunKey({
      ...input,
      clientRunKey,
      requestHash,
    });
  }
}
