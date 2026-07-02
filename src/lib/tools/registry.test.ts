import { describe, expect, it } from "vitest";
import { toolRegistry } from "../agent/tool-registry";
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
});
