import path from "path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { markdownToDocx } from "@/lib/export/markdown-to-docx";

export interface ConversionPackageAsset {
  relativePath: string;
  mimeType: string;
  buffer: Buffer;
}

export const CONVERSION_EXPORT_RENDERER_VERSION = "2026-07-19.1";

export function buildConversionExportFingerprint(input: {
  markdownContent: string;
  assets: Array<
    Pick<ConversionPackageAsset, "relativePath" | "mimeType"> & {
      storagePath?: string;
    }
  >;
}) {
  const hash = createHash("sha256");
  hash.update(CONVERSION_EXPORT_RENDERER_VERSION);
  hash.update("\0");
  hash.update(input.markdownContent);
  for (const asset of [...input.assets].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  )) {
    hash.update("\0");
    hash.update(asset.relativePath);
    hash.update("\0");
    hash.update(asset.mimeType);
    hash.update("\0");
    hash.update(asset.storagePath || "");
  }
  return hash.digest("hex");
}

export function sanitizeExportBaseName(value: string) {
  return (
    value
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[.\s-]+|[.\s-]+$/g, "") || "document"
  );
}

function safePicturePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (
    !normalized.startsWith("pics/") ||
    path.posix.normalize(normalized) !== normalized ||
    normalized.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new Error(`导出图片路径无效：${relativePath}`);
  }
  return normalized;
}

export async function buildConversionPackage(input: {
  baseName: string;
  markdownContent: string;
  pdfBuffer: Buffer;
  assets: ConversionPackageAsset[];
}) {
  const baseName = sanitizeExportBaseName(input.baseName);
  const assetsByPath = new Map(
    input.assets.map((asset) => [safePicturePath(asset.relativePath), asset])
  );
  const docxBuffer = await markdownToDocx(input.markdownContent, {
    resolveImage: async (src) => assetsByPath.get(src.replace(/^\.\//, "")) || null,
  });

  const zip = new AdmZip();
  const root = `${baseName}/`;
  zip.addFile(`${root}${baseName}.md`, Buffer.from(input.markdownContent, "utf8"));
  zip.addFile(`${root}${baseName}.pdf`, input.pdfBuffer);
  zip.addFile(`${root}${baseName}.docx`, docxBuffer);
  for (const asset of input.assets) {
    zip.addFile(`${root}${safePicturePath(asset.relativePath)}`, asset.buffer);
  }
  return zip.toBuffer();
}
