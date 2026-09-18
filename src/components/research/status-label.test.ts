import { describe, expect, it } from "vitest";
import {
  researchEvidenceStatusLabel,
  researchEvidenceTypeLabel,
  researchQuestionStatusFromEvent,
  researchRunStatusLabel,
} from "./status-label";

describe("researchRunStatusLabel", () => {
  it("maps every persisted run status to a Chinese label", () => {
    expect(researchRunStatusLabel("planning")).toBe("规划中");
    expect(researchRunStatusLabel("awaiting_confirmation")).toBe("待确认");
    expect(researchRunStatusLabel("awaiting_scope_confirmation")).toBe("待确认");
    expect(researchRunStatusLabel("queued")).toBe("排队中");
    expect(researchRunStatusLabel("researching")).toBe("进行中");
    expect(researchRunStatusLabel("evaluating")).toBe("进行中");
    expect(researchRunStatusLabel("synthesizing")).toBe("整理报告");
    expect(researchRunStatusLabel("verifying")).toBe("核验引用");
    expect(researchRunStatusLabel("completed")).toBe("已完成");
    expect(researchRunStatusLabel("failed")).toBe("已失败");
    expect(researchRunStatusLabel("cancelled")).toBe("已取消");
  });

  it("falls back to a friendly pending label for missing status", () => {
    expect(researchRunStatusLabel(null)).toBe("待开始");
    expect(researchRunStatusLabel(undefined)).toBe("待开始");
    expect(researchRunStatusLabel("")).toBe("待开始");
  });

  it("returns unknown statuses verbatim instead of guessing", () => {
    expect(researchRunStatusLabel("some_future_status")).toBe("some_future_status");
  });
});

describe("researchEvidenceStatusLabel", () => {
  it("maps evidence lifecycle statuses to Chinese", () => {
    expect(researchEvidenceStatusLabel("active")).toBe("有效");
    expect(researchEvidenceStatusLabel("superseded")).toBe("已被取代");
    expect(researchEvidenceStatusLabel("disputed")).toBe("存在争议");
    expect(researchEvidenceStatusLabel("invalidated")).toBe("已失效");
  });
});

describe("researchEvidenceTypeLabel", () => {
  it("maps evidence types to Chinese", () => {
    expect(researchEvidenceTypeLabel("direct_quote")).toBe("原文引述");
    expect(researchEvidenceTypeLabel("paraphrase")).toBe("转述");
    expect(researchEvidenceTypeLabel("visual_observation")).toBe("图表观察");
    expect(researchEvidenceTypeLabel("metadata_only")).toBe("仅元数据");
  });
});

describe("researchQuestionStatusFromEvent", () => {
  it("projects task lifecycle events onto question statuses", () => {
    expect(researchQuestionStatusFromEvent("task_started", undefined)).toBe("researching");
    expect(researchQuestionStatusFromEvent("task_completed", undefined)).toBe("evaluating");
    expect(researchQuestionStatusFromEvent("question_evaluated", "resolved")).toBe("resolved");
    expect(researchQuestionStatusFromEvent("question_evaluated", "partially_resolved")).toBe("partially_resolved");
  });

  it("ignores events that carry no question status information", () => {
    expect(researchQuestionStatusFromEvent("search_completed", undefined)).toBeNull();
    expect(researchQuestionStatusFromEvent("question_evaluated", "")).toBeNull();
    expect(researchQuestionStatusFromEvent("question_evaluated", 42)).toBeNull();
    expect(researchQuestionStatusFromEvent(undefined, undefined)).toBeNull();
  });
});
