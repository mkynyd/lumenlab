import { describe, expect, it } from "vitest";
import {
  completeAssistantProcess,
  createAssistantProcessTrace,
  hydrateAssistantProcess,
  reduceAssistantProcess,
} from "./assistant-process";

describe("assistant process trace", () => {
  it("keeps the public plan and real tool/source lifecycle in one replayable trace", () => {
    let trace = createAssistantProcessTrace(1_000);
    trace = reduceAssistantProcess(trace, {
      type: "plan_updated",
      source: "runtime",
      plan: {
        title: "研究计划",
        status: "in_progress",
        currentStepId: "gather",
        steps: [{ id: "gather", title: "收集可核验的资料", status: "in_progress" }],
      },
    });
    trace = reduceAssistantProcess(trace, {
      type: "tool_proposed",
      executionId: "tool-1",
      preview: {
        toolId: "web.search",
        toolName: "联网搜索",
        summary: "搜索公开资料",
        affectedResources: [],
        sendsToExternal: true,
        isReversible: true,
        dataTypes: [],
      },
    });
    trace = reduceAssistantProcess(trace, {
      type: "tool_started",
      executionId: "tool-1",
    });
    trace = reduceAssistantProcess(trace, {
      type: "tool_source_discovered",
      executionId: "tool-1",
      source: { type: "web", title: "Primary source", url: "https://example.com/a" },
      index: 0,
      total: 1,
    });
    trace = reduceAssistantProcess(trace, {
      type: "tool_completed",
      executionId: "tool-1",
      resultSummary: {},
    });
    trace = completeAssistantProcess(trace, "completed", 2_000);

    expect(trace).toMatchObject({
      status: "completed",
      startedAt: 1_000,
      completedAt: 2_000,
      plan: { currentStepId: "gather" },
      tools: [{
        executionId: "tool-1",
        toolId: "web.search",
        label: "搜索公开资料",
        status: "completed",
        sources: [{ title: "Primary source", url: "https://example.com/a" }],
      }],
    });
  });

  it("deduplicates replayed source events by URL", () => {
    const event = {
      type: "tool_source_discovered" as const,
      executionId: "tool-1",
      source: { type: "web" as const, title: "One", url: "https://example.com" },
      index: 0,
      total: 1,
    };
    let trace = reduceAssistantProcess(createAssistantProcessTrace(), event);
    trace = reduceAssistantProcess(trace, event);
    expect(trace.tools[0]?.sources).toHaveLength(1);
  });

  it("hydrates the same trace from persisted operational events", () => {
    const trace = hydrateAssistantProcess([
      {
        type: "agent_event",
        createdAt: "2026-08-12T12:00:00.000Z",
        payload: {
          eventJson: JSON.stringify({
            type: "tool_proposed",
            executionId: "tool-1",
            preview: {
              toolId: "web.search",
              toolName: "联网搜索",
              summary: "搜索公开资料",
              affectedResources: [],
              sendsToExternal: true,
              isReversible: true,
              dataTypes: [],
            },
          }),
        },
      },
      {
        type: "agent_event",
        createdAt: "2026-08-12T12:00:01.000Z",
        payload: {
          eventJson: JSON.stringify({
            type: "tool_source_discovered",
            executionId: "tool-1",
            source: { type: "web", title: "Example", url: "https://example.com" },
            index: 0,
            total: 1,
          }),
        },
      },
      {
        type: "run_completed",
        createdAt: "2026-08-12T12:00:02.000Z",
        payload: null,
      },
    ]);

    expect(trace).toMatchObject({
      status: "completed",
      startedAt: Date.parse("2026-08-12T12:00:00.000Z"),
      completedAt: Date.parse("2026-08-12T12:00:02.000Z"),
      tools: [{ sources: [{ title: "Example" }] }],
    });
  });
});
