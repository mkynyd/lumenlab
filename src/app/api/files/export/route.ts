import AdmZip from "adm-zip";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readStoredObject, type StorageProvider } from "@/lib/storage/object-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_EXPORT_FILES = 50;

const exportSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(MAX_EXPORT_FILES),
});

/** 去掉会破坏 zip 路径的字符；解析正文与图片引用都按原名对齐，不在这里改写内容。 */
function safeName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || "未命名";
}

function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base} (${index})`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

/** 去掉原扩展名，正文统一是 Markdown。 */
function markdownBaseName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  return safeName(base || originalName);
}

function buildReadme(total: number, skipped: string[]): string {
  const lines = [
    "LumenLab 资料导出说明",
    "",
    `- 导出内容：${total} 份资料的「基础解析」Markdown 正文，不含 AI 整理内容。`,
    "- 目录结构：每份资料一个文件夹，正文是同名 .md 文件；文档里引用的图片按解析时的相对路径放在同一文件夹内，Markdown 中的图片链接可直接打开。",
    "- 未包含：原件本身（PDF / Office / 图片等）。需要原件时请在资料页对单个文件使用「下载原件」。",
  ];
  if (skipped.length > 0) {
    lines.push(
      `- 跳过 ${skipped.length} 份没有解析正文的资料（解析失败、解析中或图片）：`,
      ...skipped.map((name) => `  - ${name}`)
    );
  }
  return lines.join("\n");
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const parsed = exportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `请选择 1—${MAX_EXPORT_FILES} 份资料后再导出` },
      { status: 400 }
    );
  }

  // 所有权在查询里限定：请求里混入别人的 id 时只会被静默排除，不会泄露。
  const files = await prisma.fileAsset.findMany({
    where: { id: { in: parsed.data.fileIds }, userId: session.user.id },
    select: {
      id: true,
      originalName: true,
      textContent: true,
      resources: {
        select: {
          relativePath: true,
          storageProvider: true,
          storagePath: true,
        },
      },
    },
  });

  if (files.length === 0) {
    return NextResponse.json({ error: "没有可导出的资料" }, { status: 404 });
  }

  try {
    const zip = new AdmZip();
    const usedNames = new Set<string>();
    const skipped: string[] = [];
    let exported = 0;

    for (const file of files) {
      if (!file.textContent?.trim()) {
        skipped.push(file.originalName);
        continue;
      }
      const dir = uniqueName(markdownBaseName(file.originalName), usedNames);
      zip.addFile(
        `${dir}/${dir}.md`,
        Buffer.from(file.textContent, "utf-8")
      );
      for (const resource of file.resources) {
        // 图片缺失不影响正文导出，跳过即可。
        const data = await readStoredObject({
          provider: resource.storageProvider as StorageProvider,
          key: resource.storagePath,
        }).catch(() => null);
        if (!data) continue;
        zip.addFile(`${dir}/${resource.relativePath}`, data);
      }
      exported += 1;
    }

    if (exported === 0) {
      return NextResponse.json(
        { error: "所选资料都还没有解析正文，无法导出" },
        { status: 400 }
      );
    }

    zip.addFile("导出说明.txt", Buffer.from(buildReadme(exported, skipped), "utf-8"));

    const buffer = zip.toBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          "资料导出.zip"
        )}`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logger.error("资料导出失败", {
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "导出失败，请稍后重试" }, { status: 500 });
  }
}
