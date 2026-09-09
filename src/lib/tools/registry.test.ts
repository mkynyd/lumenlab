import { describe, expect, it } from "vitest";
import { toolRegistry } from "../agent/tool-registry";
import { executeTool, hasToolHandler } from "../agent/tool-executor";
import "./registry";

describe("tool registry", () => {
  it("registers arxiv tools at L1 with network side effects", () => {
    for (const id of ["arxiv.search", "arxiv.read", "arxiv.fetch"]) {
      const tool = toolRegistry.require(id);
      expect(tool.riskLevel).toBe("L1");
      expect(tool.requiresNetwork).toBe(true);
      expect(tool.defaultApprovalMode).toBe("auto");
      expect(tool.hasExternalSideEffect).toBe(true);
    }
  });

  it("registers sciverse tools at L1 read-only network auto with handlers", () => {
    for (const id of ["sciverse.search", "sciverse.semantic_search", "sciverse.read"]) {
      const tool = toolRegistry.require(id);
      expect(tool.riskLevel).toBe("L1");
      expect(tool.isReadOnly).toBe(true);
      expect(tool.requiresNetwork).toBe(true);
      expect(tool.hasExternalSideEffect).toBe(true);
      expect(tool.defaultApprovalMode).toBe("auto");
      expect(tool.auditLevel).toBe("minimal");
      expect(hasToolHandler(id)).toBe(true);
    }
  });

  it("sciverse handlers fail closed when SCIVERSE_API_TOKEN is missing", async () => {
    const saved = process.env.SCIVERSE_API_TOKEN;
    delete process.env.SCIVERSE_API_TOKEN;
    try {
      for (const id of ["sciverse.search", "sciverse.semantic_search", "sciverse.read"]) {
        const result = await executeTool(
          id,
          { userId: "user-1", conversationId: "conversation-1" },
          { query: "q", docId: "d" }
        );
        expect(result.ok).toBe(true);
        expect(result.result).toMatchObject({ error: "SCIVERSE_NOT_CONFIGURED" });
      }
    } finally {
      if (saved !== undefined) process.env.SCIVERSE_API_TOKEN = saved;
    }
  });

  it("registers reference tools with mixed risk levels", () => {
    expect(toolRegistry.require("reference.add").riskLevel).toBe("L2");
    expect(toolRegistry.require("reference.list").riskLevel).toBe("L1");
    expect(toolRegistry.require("reference.attach").riskLevel).toBe("L2");
    expect(toolRegistry.require("reference.format").riskLevel).toBe("L1");
    expect(toolRegistry.require("reference.add").defaultApprovalMode).toBe(
      "ask_first"
    );
  });

  it("registers artifact.export_docx at L3 ask_each", () => {
    const tool = toolRegistry.require("artifact.export_docx");
    expect(tool.riskLevel).toBe("L3");
    expect(tool.defaultApprovalMode).toBe("ask_each");
    expect(tool.isReversible).toBe(true);
  });

  it("keeps existing tool risk levels intact", () => {
    expect(toolRegistry.require("project_files.delete").riskLevel).toBe("L3");
    expect(toolRegistry.require("artifact.save").riskLevel).toBe("L2");
    expect(toolRegistry.require("web.search").riskLevel).toBe("L1");
    expect(toolRegistry.require("project_files.list").riskLevel).toBe("L1");
  });

  it("lets project RAG use the server-side project context", () => {
    const schema = toolRegistry.require("project_rag.search").inputSchema;
    expect(schema.required).toEqual(["query"]);
  });

  it("registers the six learning tools with policy-aligned risk", () => {
    const writeTools = [
      "learning.goal.upsert",
      "learning.map.generate",
      "learning.practice.create",
      "learning.attempt.submit",
      "learning.review.next",
    ];

    for (const id of writeTools) {
      const tool = toolRegistry.require(id);
      expect(tool.riskLevel).toBe("L2");
      expect(tool.defaultApprovalMode).toBe("ask_first");
      expect(tool.isReadOnly).toBe(false);
    }

    const progress = toolRegistry.require("learning.progress.read");
    expect(progress.riskLevel).toBe("L1");
    expect(progress.defaultApprovalMode).toBe("auto");
    expect(progress.isReadOnly).toBe(true);

    for (const id of [
      "learning.map.generate",
      "learning.practice.create",
    ]) {
      const modelBacked = toolRegistry.require(id);
      expect(modelBacked.requiresNetwork).toBe(true);
      expect(modelBacked.hasExternalSideEffect).toBe(true);
      expect(modelBacked.containsSensitiveData).toBe(true);
    }
  });

  it("does not expose answer criteria through learning tool contracts", () => {
    for (const tool of toolRegistry
      .list()
      .filter((item) => item.toolId.startsWith("learning."))) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain("answerCriteria");
      expect(JSON.stringify(tool.outputSchema)).not.toContain("answerCriteria");
    }
  });

  it("fails closed when a learning tool lacks verified project context", async () => {
    const result = await executeTool(
      "learning.progress.read",
      { userId: "user-1", conversationId: "conversation-1" },
      { goalId: "goal-1" }
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: "HANDLER_ERROR",
      errorMessage: "学习工具只能在已验证的项目上下文中运行",
    });
  });
});
