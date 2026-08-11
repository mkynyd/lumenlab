import { readFileSync } from "node:fs";
import path from "node:path";

export type LegalDocumentSlug = "terms" | "privacy";

const LEGAL_DOCUMENTS: Record<LegalDocumentSlug, { file: string; title: string }> = {
  terms: { file: "terms-of-service.md", title: "用户协议" },
  privacy: { file: "privacy-policy.md", title: "隐私政策" },
};

export function getLegalDocumentTitle(slug: LegalDocumentSlug): string {
  return LEGAL_DOCUMENTS[slug].title;
}

/** 读取仓库根 legal/ 下的协议 Markdown 原文（构建/请求时在服务端执行） */
export function readLegalDocument(slug: LegalDocumentSlug): string {
  return readFileSync(
    path.join(process.cwd(), "legal", LEGAL_DOCUMENTS[slug].file),
    "utf8"
  );
}
