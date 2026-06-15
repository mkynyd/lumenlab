import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/query-keys";

describe("queryKeys", () => {
  it("builds stable hierarchical keys", () => {
    expect(queryKeys.conversations.detail("conversation-1")).toEqual([
      "conversations",
      "conversation-1",
    ]);
    expect(queryKeys.projects.files("project-1")).toEqual([
      "projects",
      "project-1",
      "files",
    ]);
    expect(queryKeys.projects.artifacts("project-1")).toEqual([
      "projects",
      "project-1",
      "artifacts",
    ]);
  });
});
