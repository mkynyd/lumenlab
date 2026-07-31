import { describe, expect, it } from "vitest";

import {
  ExecutionSequenceCursor,
  parseExecutionCursor,
} from "./execution-cursor";

describe("execution replay cursor", () => {
  it("accepts a non-negative Last-Event-ID or afterSequence", () => {
    expect(parseExecutionCursor({ lastEventId: null, afterSequence: null })).toBe(0);
    expect(parseExecutionCursor({ lastEventId: "7", afterSequence: null })).toBe(7);
    expect(parseExecutionCursor({ lastEventId: null, afterSequence: "9" })).toBe(9);
    expect(parseExecutionCursor({ lastEventId: "11", afterSequence: "11" })).toBe(11);
  });

  it("rejects malformed or conflicting cursors", () => {
    for (const value of ["-1", "1.5", "abc", ""]) {
      expect(() =>
        parseExecutionCursor({ lastEventId: value, afterSequence: null })
      ).toThrow();
    }
    expect(() =>
      parseExecutionCursor({ lastEventId: "2", afterSequence: "3" })
    ).toThrow();
  });

  it("deduplicates monotonically by run identity and sequence", () => {
    const cursor = new ExecutionSequenceCursor("run-1", 3);

    expect(cursor.accept({ agentExecutionId: "run-1", sequence: 3 })).toBe(false);
    expect(cursor.accept({ agentExecutionId: "run-1", sequence: 4 })).toBe(true);
    expect(cursor.accept({ agentExecutionId: "run-1", sequence: 4 })).toBe(false);
    expect(cursor.sequence).toBe(4);
    expect(() =>
      cursor.accept({ agentExecutionId: "run-2", sequence: 5 })
    ).toThrow();
  });
});
