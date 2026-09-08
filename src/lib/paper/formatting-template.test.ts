import { describe, expect, it } from "vitest";
import { assertFormattingTemplate, formattingManifestHash, formattingTemplateAvailability, type FormattingTemplateInput } from "./formatting-template";
import { normalizeTemplateManifest } from "./template-registry";

const snapshot = { materialized: true, snapshotId: "snap-1", sourceArchive: { provider: "qiniu", key: "template-snapshots/cqu.zip", sha256: "archive-sha" } };
const manifest = normalizeTemplateManifest({ id: "cqu", university: "重庆大学", format: "latex", documentClass: "cquthesis", engine: "xelatex", bibliography: "bibtex", supportedBlocks: [], upstreamSnapshot: snapshot });
const sample = { fixtureId: "sample-academic-v1", status: "verified", pdf: { provider: "qiniu", key: "template-samples/cqu.pdf", sha256: "pdf-sha", bytes: 100, mimeType: "application/pdf" } };
const proof = { snapshotId: "snap-1", sourceArchiveSha256: "archive-sha", manifestHash: formattingManifestHash(manifest), environment: "linux-isolated", samplePassed: true, docxPassed: true, markdownPassed: true };
const base: FormattingTemplateInput = { manifest, pinnedUpstreamSnapshot: snapshot, validation: { status: "Verified", ...proof, formattingValidation: proof }, sample, status: "Verified" };

describe("formatting template admission", () => {
  it("admits only templates with a current-snapshot isolated DOCX and Markdown proof", () => {
    expect(formattingTemplateAvailability(base)).toMatchObject({ canSubmit: true, reason: null, verified: true, hasLatex: true });
  });

  it("rejects a historical sample when the isolated proof is missing or stale", () => {
    const withoutProof = { ...base, validation: { status: "Verified" } };
    expect(formattingTemplateAvailability(withoutProof)).toMatchObject({ canSubmit: false, reason: "尚未通过当前快照的隔离排版验证" });
    const staleSnapshot = { ...base, validation: { status: "Verified", formattingValidation: { ...proof, snapshotId: "snap-0" } } };
    expect(formattingTemplateAvailability(staleSnapshot)).toMatchObject({ canSubmit: false, reason: "尚未通过当前快照的隔离排版验证" });
    const hostProof = { ...base, validation: { status: "Verified", formattingValidation: { ...proof, environment: "macos" } } };
    expect(formattingTemplateAvailability(hostProof)).toMatchObject({ canSubmit: false, reason: "尚未通过当前快照的隔离排版验证" });
  });

  it("falls back to the resolved engine and document class recorded by the isolated run", () => {
    const resolvedManifest = normalizeTemplateManifest({ id: "scu", university: "四川大学", format: "latex", supportedBlocks: [], upstreamSnapshot: snapshot });
    const resolved = { ...base, manifest: resolvedManifest, validation: { status: "Verified", compileEngine: "xelatex", resolvedDocumentClass: "scuthesis", formattingValidation: { ...proof, manifestHash: formattingManifestHash(resolvedManifest) } } };
    expect(formattingTemplateAvailability(resolved)).toMatchObject({ canSubmit: true, reason: null });
    const unresolved = { ...resolved, validation: { ...resolved.validation, resolvedDocumentClass: undefined } };
    expect(formattingTemplateAvailability(unresolved)).toMatchObject({ canSubmit: false, reason: "模板编译引擎或文档类不完整" });
  });

  it("rejects a submit when required metadata is missing", () => {
    expect(() => assertFormattingTemplate(base, { title: "题目", authors: [] })).toThrow(/请补齐模板信息/);
    expect(assertFormattingTemplate(base, { title: "题目", authors: ["作者"] })).toMatchObject({ documentClass: "cquthesis" });
  });
});
