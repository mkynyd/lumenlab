import { createHash } from "node:crypto";
import { normalizeTemplateManifest, readTemplateSamplePdf, type AcademicTemplateManifest } from "./template-registry";
import { isLatexTemplateFormat } from "./template-snapshot";
import { FormattingError, type FormattingMetadata } from "./formatting-contracts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type FormattingTemplateInput = { manifest: unknown; pinnedUpstreamSnapshot: unknown; validation: unknown; sample: unknown; status?: string };
export type FormattingTemplateAvailability = { canSubmit: boolean; reason: string | null; verified: boolean; hasLatex: boolean; snapshotId: string | null; requiredMetadata: string[] };

/** A successful historical sample is not sufficient after its snapshot changes. */
export function formattingTemplateAvailability(input: FormattingTemplateInput): FormattingTemplateAvailability {
  const snapshot = record(input.pinnedUpstreamSnapshot);
  const validation = record(input.validation);
  const proof = record(validation.formattingValidation);
  let manifest: AcademicTemplateManifest;
  const base = { canSubmit: false, reason: null as string | null, verified: false, hasLatex: false, snapshotId: typeof snapshot.snapshotId === "string" ? snapshot.snapshotId : null, requiredMetadata: ["title", "authors"] };
  try { manifest = normalizeTemplateManifest(input.manifest); } catch { return { ...base, reason: "模板描述不完整" }; }
  base.hasLatex = isLatexTemplateFormat(manifest.format);
  base.requiredMetadata = [...new Set(["title", "authors", ...(manifest.requiredMetadata ?? [])])];
  if (!base.hasLatex) return { ...base, reason: "此模板格式尚不支持后台排版" };
  if (input.status === "Deprecated" || input.status === "Needs Review" || validation.status === "Needs Review") return { ...base, reason: "模板需要重新审核" };
  const archive = record(snapshot.sourceArchive);
  if (snapshot.materialized !== true || !base.snapshotId || !archive.key || !archive.sha256 || !["local", "qiniu"].includes(String(archive.provider))) return { ...base, reason: "模板尚未固定可执行快照" };
  // Some snapshots resolve their class from nested sources at compile time, so
  // the isolated validation record may be the only place the resolved engine and
  // documentClass exist. Both are server-produced and are re-resolved at compile.
  const engine = manifest.engine ?? (typeof validation.compileEngine === "string" ? validation.compileEngine : null);
  const documentClass = manifest.documentClass ?? (typeof validation.resolvedDocumentClass === "string" ? validation.resolvedDocumentClass : null);
  if (!engine || !["xelatex", "pdflatex", "lualatex"].includes(engine) || !documentClass) return { ...base, reason: "模板编译引擎或文档类不完整" };
  if (manifest.upstreamSnapshot?.snapshotId !== snapshot.snapshotId || manifest.upstreamSnapshot?.sourceArchive?.sha256 !== archive.sha256 || manifest.upstreamSnapshot?.sourceArchive?.key !== archive.key) return { ...base, reason: "模板描述与上游快照不一致" };
  base.verified = validation.status === "Verified" && Boolean(readTemplateSamplePdf(input.sample));
  if (!base.verified) return { ...base, reason: "模板尚未通过样例编译" };
  if (proof.snapshotId !== snapshot.snapshotId || proof.sourceArchiveSha256 !== archive.sha256 || proof.manifestHash !== formattingManifestHash(manifest)
    || proof.environment !== "linux-isolated" || proof.samplePassed !== true || proof.docxPassed !== true || proof.markdownPassed !== true) {
    return { ...base, reason: "尚未通过当前快照的隔离排版验证" };
  }
  return { ...base, canSubmit: true, reason: null };
}

export function formattingManifestHash(manifest: AcademicTemplateManifest): string {
  // Validation timestamps are not rendering inputs.
  const rendering: Record<string, unknown> = { ...manifest };
  delete rendering.validation;
  delete rendering.sample;
  return createHash("sha256").update(JSON.stringify(rendering)).digest("hex");
}

export function assertFormattingTemplate(input: FormattingTemplateInput, metadata: FormattingMetadata): AcademicTemplateManifest {
  const availability = formattingTemplateAvailability(input);
  if (!availability.canSubmit) throw new FormattingError("TEMPLATE_UNAVAILABLE", availability.reason ?? "模板暂不可用", 409);
  const fields = metadata as unknown as Record<string, unknown>;
  const missing = availability.requiredMetadata.filter((key) => !fields[key] || (Array.isArray(fields[key]) && fields[key].length === 0));
  if (missing.length) throw new FormattingError("METADATA_REQUIRED", `请补齐模板信息：${missing.join("、")}`);
  return normalizeTemplateManifest(input.manifest);
}
