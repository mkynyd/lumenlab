import { describe, expect, it } from "vitest";

import { buildAgentExecutionRequestHash } from "@/lib/agent/executions/request-hash";

describe("agent execution request hash", () => {
  it("is stable across object key and selected-file ordering", () => {
    const first = buildAgentExecutionRequestHash({
      message: "请解释这个定律",
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "high",
      projectId: "project-1",
      selectedFiles: [
        { id: "file-b", contentFingerprint: "sha256:b" },
        { id: "file-a", contentFingerprint: "sha256:a" },
      ],
      attachments: [],
      options: { skillOff: false, webSearchActive: true },
    });
    const second = buildAgentExecutionRequestHash({
      options: { webSearchActive: true, skillOff: false },
      attachments: [],
      selectedFiles: [
        { contentFingerprint: "sha256:a", id: "file-a" },
        { contentFingerprint: "sha256:b", id: "file-b" },
      ],
      projectId: "project-1",
      reasoningEffort: "high",
      thinkingEnabled: true,
      model: "deepseek-v4-pro",
      message: "请解释这个定律",
    });

    expect(second).toBe(first);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("changes when attachment content changes even if the filename is stable", () => {
    const base = {
      message: "阅读附件",
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "high" as const,
      selectedFiles: [],
      options: {},
    };

    expect(
      buildAgentExecutionRequestHash({
        ...base,
        attachments: [
          {
            name: "lecture.pdf",
            mimeType: "application/pdf",
            contentFingerprint: "sha256:old",
          },
        ],
      })
    ).not.toBe(
      buildAgentExecutionRequestHash({
        ...base,
        attachments: [
          {
            name: "lecture.pdf",
            mimeType: "application/pdf",
            contentFingerprint: "sha256:new",
          },
        ],
      })
    );
  });
});
