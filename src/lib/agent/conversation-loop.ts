/**
 * Compatibility entry point for the runtime-owned Agent loop.
 *
 * New code lives under `loop/agent-loop.ts`; this export keeps existing imports
 * stable while removing the former route-driven skeleton and test-only runner.
 */
export { runAgentLoop } from "./loop/agent-loop";
export type { AgentLoopInput, AgentLoopResult } from "./loop/agent-loop";
