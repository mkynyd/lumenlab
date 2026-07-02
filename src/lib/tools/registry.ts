/**
 * 内置工具注册
 *
 * 集中声明 Tool 元数据 + 把 handler 挂到 Tool Executor。
 * 任何模块只需 `import "@/lib/tools/registry";` 即可触发注册（副作用导入）。
 *
 * 风险等级（与 plan 对齐）：
 *   L1 — project_files.list / read、artifact.list、web.search、web.fetch、
 *         arxiv.search、arxiv.read、arxiv.fetch、reference.list、reference.format
 *   L2 — artifact.save、reference.add、reference.attach
 *   L3 — project_files.delete、artifact.export_docx
 */

import type { ToolMetadata } from "../agent/types";
import { toolRegistry } from "../agent/tool-registry";
import { registerToolHandler } from "../agent/tool-executor";
import { listProjectFiles } from "./project-files/list";
import { readProjectFile } from "./project-files/read";
import { deleteProjectFile } from "./project-files/delete";
import { saveArtifact } from "./artifacts/save";
import { listArtifacts } from "./artifacts/list";
import { webSearch } from "./web/search";
import { webFetch } from "./web/fetch";
import { ragSearch } from "./knowledge/project-rag";
import { arxivSearch } from "./arxiv/search";
import { arxivRead } from "./arxiv/abstract";
import { arxivFetch } from "./arxiv/fetch";
import {
  addReference,
  listReferences,
  attachReferenceToArtifact,
  formatAttachedReferences,
} from "./reference/manage";
import { exportArtifactAsDocx } from "./artifact-export/docx";

const TOOLS: ToolMetadata[] = [
  {
    toolId: "project_files.list",
    name: "列出项目资料",
    description: "列出项目中的所有资料文件。",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: ["project.read"],
  },
  {
    toolId: "project_files.read",
    name: "读取项目资料",
    description: "读取已解析项目资料的文本内容。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        fileId: { type: "string" },
        maxChars: { type: "integer" },
      },
      required: ["fileId"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: ["project.read"],
  },
  {
    toolId: "project_files.delete",
    name: "删除项目资料",
    description: "删除项目中的一份资料（不可恢复）。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        fileId: { type: "string" },
      },
      required: ["projectId", "fileId"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L3",
    isReadOnly: false,
    hasExternalSideEffect: false,
    isReversible: false,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "ask_each",
    allowedSkillIds: [],
    auditLevel: "verbose",
    requiredScopes: ["project.write"],
  },
  {
    toolId: "artifact.save",
    name: "保存成果",
    description: "把当前对话产出的 Markdown 存为可复用的成果。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        conversationId: { type: "string" },
        messageId: { type: "string" },
        title: { type: "string" },
        type: { type: "string" },
        format: { type: "string" },
        content: { type: "string" },
      },
      required: ["title", "content"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L2",
    isReadOnly: false,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "ask_first",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: ["artifact.write"],
  },
  {
    toolId: "artifact.list",
    name: "列出成果",
    description: "列出当前项目 / 对话下的成果。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        conversationId: { type: "string" },
      },
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: ["artifact.read"],
  },
  {
    toolId: "project_rag.search",
    name: "项目知识检索",
    description: "在已解析的项目资料中按关键词检索最相关的段落。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        query: { type: "string" },
        maxResults: { type: "integer" },
      },
      required: ["query"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: ["project.read"],
  },
  {
    toolId: "web.search",
    name: "联网检索",
    description: "通过模型内置 web_search 联网检索关键词。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer" },
      },
      required: ["query"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: true,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: true,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: [],
  },
  {
    toolId: "web.fetch",
    name: "抓取网页",
    description: "抓取公开网页（仅白名单域名）。",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: true,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: true,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: [],
  },
  {
    toolId: "arxiv.search",
    name: "arXiv 搜索",
    description: "用关键词在 arXiv 检索论文（标题 / 摘要 / 作者）。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer" },
      },
      required: ["query"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: true,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: true,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: [],
  },
  {
    toolId: "arxiv.read",
    name: "arXiv 论文元数据",
    description: "拉取单篇 arXiv 论文的标题 / 作者 / 摘要。",
    inputSchema: {
      type: "object",
      properties: { arxivId: { type: "string" } },
      required: ["arxivId"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: true,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: true,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: [],
  },
  {
    toolId: "arxiv.fetch",
    name: "arXiv 页面抓取",
    description: "抓取 arxiv.org 公开页面（abs / pdf）。",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: true,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: true,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: [],
  },
  {
    toolId: "reference.add",
    name: "新增参考文献",
    description: "把一条文献（DOI / arxivId / 手动字段）存入引用库。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        doi: { type: "string" },
        arxivId: { type: "string" },
        title: { type: "string" },
        authors: { type: "array", items: { type: "string" } },
        year: { type: "integer" },
        venue: { type: "string" },
        url: { type: "string" },
      },
      required: ["title"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L2",
    isReadOnly: false,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "ask_first",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: ["artifact.write"],
  },
  {
    toolId: "reference.list",
    name: "列出参考文献",
    description: "按项目 / 对话列出已存引用。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        conversationId: { type: "string" },
      },
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: ["artifact.read"],
  },
  {
    toolId: "reference.attach",
    name: "挂载引用到成果",
    description: "把已有文献绑定到某条 artifact，可指定 inline 标记与样式。",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string" },
        referenceId: { type: "string" },
        format: {
          type: "string",
          enum: ["apa", "mla", "chicago", "gbt7714", "ieee", "harvard"],
        },
        inlineMarker: { type: "string" },
      },
      required: ["artifactId", "referenceId"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L2",
    isReadOnly: false,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "ask_first",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: ["artifact.write"],
  },
  {
    toolId: "reference.format",
    name: "格式化引用",
    description: "把一个 artifact 上挂的引用按指定样式渲染为 inline + 参考文献条目。",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string" },
        format: {
          type: "string",
          enum: ["apa", "mla", "chicago", "gbt7714", "ieee", "harvard"],
        },
      },
      required: ["artifactId", "format"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: ["artifact.read"],
  },
  {
    toolId: "artifact.export_docx",
    name: "导出成果为 Word",
    description: "把 Markdown artifact 渲染为 .docx（base64），需要用户确认。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        artifactId: { type: "string" },
      },
      required: ["artifactId"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L3",
    isReadOnly: false,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "ask_each",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: ["artifact.write"],
  },
];

let registered = false;

export function registerBuiltinTools(): void {
  if (registered) return;
  registered = true;

  for (const tool of TOOLS.filter((item) => !toolRegistry.has(item.toolId))) {
    toolRegistry.register(tool);
  }

  registerToolHandler("project_files.list", async (ctx, args) => {
    return listProjectFiles(
      ctx.userId,
      String(args.projectId ?? ctx.projectId ?? "")
    );
  });
  registerToolHandler("project_files.read", async (ctx, args) => {
    return readProjectFile(
      ctx.userId,
      String(args.projectId ?? ctx.projectId ?? ""),
      String(args.fileId),
      args.maxChars ? Number(args.maxChars) : 8000
    );
  });
  registerToolHandler("project_files.delete", async (ctx, args) => {
    return deleteProjectFile(
      ctx.userId,
      String(args.projectId),
      String(args.fileId)
    );
  });
  registerToolHandler("artifact.save", async (ctx, args) => {
    return saveArtifact(ctx.userId, ctx.projectId, ctx.conversationId, undefined, {
      title: String(args.title ?? "未命名成果"),
      type: args.type ? String(args.type) : undefined,
      format: args.format ? String(args.format) : undefined,
      content: String(args.content ?? ""),
    });
  });
  registerToolHandler("artifact.list", async (ctx, args) => {
    return listArtifacts(
      ctx.userId,
      args.projectId ? String(args.projectId) : ctx.projectId,
      args.conversationId ? String(args.conversationId) : ctx.conversationId
    );
  });
  registerToolHandler("project_rag.search", async (ctx, args) => {
    return ragSearch(
      ctx.userId,
      String(args.projectId ?? ctx.projectId ?? ""),
      String(args.query ?? ""),
      args.maxResults ? Number(args.maxResults) : 5
    );
  });
  registerToolHandler("web.search", async (_ctx, args) => {
    return webSearch(String(args.query ?? ""), args.maxResults ? Number(args.maxResults) : 5);
  });
  registerToolHandler("web.fetch", async (_ctx, args) => {
    return webFetch(String(args.url ?? ""));
  });
  registerToolHandler("arxiv.search", async (_ctx, args) => {
    return arxivSearch(String(args.query ?? ""), args.maxResults ? Number(args.maxResults) : 5);
  });
  registerToolHandler("arxiv.read", async (_ctx, args) => {
    return arxivRead(String(args.arxivId ?? ""));
  });
  registerToolHandler("arxiv.fetch", async (_ctx, args) => {
    return arxivFetch(String(args.url ?? ""));
  });
  registerToolHandler("reference.add", async (ctx, args) => {
    const projectId = (args.projectId as string | undefined) ?? ctx.projectId;
    return addReference(ctx.userId, projectId, {
      doi: args.doi ? String(args.doi) : undefined,
      arxivId: args.arxivId ? String(args.arxivId) : undefined,
      title: String(args.title ?? ""),
      authors: Array.isArray(args.authors)
        ? (args.authors as unknown[]).filter((a): a is string => typeof a === "string")
        : undefined,
      year: args.year ? Number(args.year) : undefined,
      venue: args.venue ? String(args.venue) : undefined,
      url: args.url ? String(args.url) : undefined,
    });
  });
  registerToolHandler("reference.list", async (ctx, args) => {
    return listReferences(
      ctx.userId,
      args.projectId ? String(args.projectId) : ctx.projectId,
      args.conversationId ? String(args.conversationId) : ctx.conversationId
    );
  });
  registerToolHandler("reference.attach", async (ctx, args) => {
    return attachReferenceToArtifact(
      ctx.userId,
      String(args.artifactId ?? ""),
      String(args.referenceId ?? ""),
      {
        format: args.format ? String(args.format) : undefined,
        inlineMarker: args.inlineMarker ? String(args.inlineMarker) : undefined,
      }
    );
  });
  registerToolHandler("reference.format", async (ctx, args) => {
    return formatAttachedReferences(
      ctx.userId,
      String(args.artifactId ?? ""),
      String(args.format ?? "apa")
    );
  });
  registerToolHandler("artifact.export_docx", async (ctx, args) => {
    return exportArtifactAsDocx(
      ctx.userId,
      String(args.artifactId ?? "")
    );
  });
}

// 模块副作用注册：导入即生效
registerBuiltinTools();
