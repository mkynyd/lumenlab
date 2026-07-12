import { prisma } from "@/lib/db";

export interface ContextAssemblyInput {
  userId: string;
  projectId?: string;
  selectedFileIds: string[];
}

export interface ContextProject {
  id: string;
  userId: string;
  name: string;
  type: string;
  description: string | null;
}

export interface ContextFile {
  id: string;
  originalName: string;
  mimeType: string;
  status: string;
  processingMetadata: unknown;
}

export interface AssembledResourceContext {
  project: ContextProject | null;
  selectedFiles: ContextFile[];
  selectedFileIds: string[];
  requiresVisionModel: boolean;
}

export interface ContextAssembler {
  assemble(input: ContextAssemblyInput): Promise<AssembledResourceContext>;
}

export class ContextAssemblyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ContextAssemblyError";
  }
}

function metadataRequiresVision(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return false;
  const record = metadata as Record<string, unknown>;
  return (
    record.requiresVisionModel === true ||
    (typeof record.retainedImageCount === "number" &&
      record.retainedImageCount > 0)
  );
}

/**
 * Loads and validates the resource context used by both ordinary and project
 * conversations. Keeping ownership checks here prevents provider/tool code
 * from learning Prisma query details.
 */
export class PrismaContextAssembler implements ContextAssembler {
  async assemble(
    input: ContextAssemblyInput
  ): Promise<AssembledResourceContext> {
    const selectedFileIds = [...new Set(input.selectedFileIds)];
    const project = input.projectId
      ? await prisma.project.findFirst({
          where: { id: input.projectId, userId: input.userId },
        })
      : null;

    if (input.projectId && !project) {
      throw new ContextAssemblyError(404, "项目不存在或无访问权限");
    }
    if (selectedFileIds.length > 0 && !input.projectId) {
      throw new ContextAssemblyError(400, "选择文件时必须提供项目 ID");
    }

    const selectedFiles =
      project && selectedFileIds.length > 0
        ? await prisma.fileAsset.findMany({
            where: {
              id: { in: selectedFileIds },
              userId: input.userId,
              projectId: project.id,
            },
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              status: true,
              processingMetadata: true,
            },
          })
        : [];

    if (selectedFiles.length !== selectedFileIds.length) {
      throw new ContextAssemblyError(400, "部分文件不存在或不属于当前项目");
    }

    return {
      project,
      selectedFiles,
      selectedFileIds,
      requiresVisionModel: selectedFiles.some((file) =>
        metadataRequiresVision(file.processingMetadata)
      ),
    };
  }
}
