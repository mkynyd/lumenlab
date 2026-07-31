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
import { activateSkill, buildActivateSkillEnum } from "../agent/skill-activate-handler";
import { parsePlanUpdate } from "../agent/plan";
import { learningService } from "@/lib/learning/services";
import { practiceAttemptSubmissionSchema } from "@/lib/learning/validators";

const LEARNING_TOOLS: ToolMetadata[] = [
  {
    toolId: "learning.goal.upsert",
    name: "创建学习目标",
    description: "在当前项目中创建并激活一个可追踪的学习目标。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        purpose: { type: "string" },
        targetDate: { type: "string" },
        dailyMinutes: { type: "integer" },
        idempotencyKey: { type: "string" },
      },
      required: ["title", "idempotencyKey"],
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
    requiredScopes: ["project.write"],
  },
  {
    toolId: "learning.map.generate",
    name: "生成知识地图",
    description: "基于当前项目已经确认的学习范围生成版本化知识地图。",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["goalId", "idempotencyKey"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L2",
    isReadOnly: false,
    hasExternalSideEffect: true,
    isReversible: true,
    containsSensitiveData: true,
    requiresNetwork: true,
    estimatedCost: "model-call",
    defaultApprovalMode: "ask_first",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: ["project.read", "project.write"],
  },
  {
    toolId: "learning.practice.create",
    name: "创建诊断练习",
    description: "为当前学习目标创建 5–10 题诊断练习，不返回答案判据。",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["goalId", "idempotencyKey"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L2",
    isReadOnly: false,
    hasExternalSideEffect: true,
    isReversible: true,
    containsSensitiveData: true,
    requiresNetwork: true,
    estimatedCost: "model-call",
    defaultApprovalMode: "ask_first",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: ["project.read", "project.write"],
  },
  {
    toolId: "learning.attempt.submit",
    name: "提交练习答案",
    description: "向指定学习会话题目提交答案并更新服务端学习证据。",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sessionItemId: { type: "string" },
        answer: {},
        idempotencyKey: { type: "string" },
      },
      required: [
        "sessionId",
        "sessionItemId",
        "answer",
        "idempotencyKey",
      ],
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
    requiredScopes: ["project.write"],
  },
  {
    toolId: "learning.review.next",
    name: "创建下一组复习",
    description: "从当前学习目标的到期项创建下一组复习会话。",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
        limit: { type: "integer" },
        idempotencyKey: { type: "string" },
      },
      required: ["goalId", "idempotencyKey"],
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
    requiredScopes: ["project.read", "project.write"],
  },
  {
    toolId: "learning.progress.read",
    name: "读取学习进度",
    description: "读取 new、learning、mastered、due 和资料新鲜度状态数量。",
    inputSchema: {
      type: "object",
      properties: { goalId: { type: "string" } },
      required: ["goalId"],
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
];

const TOOLS: ToolMetadata[] = [
  ...LEARNING_TOOLS,
  {
    toolId: "plan.update",
    name: "更新任务计划",
    description: "更新研究或工作流任务的简短公开计划状态，不执行外部操作。",
    inputSchema: {
      type: "object",
      properties: {
        steps: { type: "array" },
        currentStepId: { type: "string" },
      },
      required: ["steps", "currentStepId"],
    },
    outputSchema: { type: "object" },
    riskLevel: "L0",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    estimatedCost: "free",
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "minimal",
    requiredScopes: [],
  },
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
    description: "抓取公开网页（仅允许白名单域名，由 WEB_FETCH_ALLOWLIST 配置）。",
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
  {
    toolId: "skill.activate",
    name: "activate_skill",
    description: "激活一个技能以获取详细的工作指令。当任务匹配某个技能的描述时调用此工具。",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: [],
          description: "要激活的技能名称",
        },
      },
      required: ["name"],
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
    requiredScopes: [],
  },
];

let registered = false;

export function refreshActivateSkillSchema(): void {
  const activateTool = toolRegistry.get("skill.activate");
  if (!activateTool) return;
  const skillIds = buildActivateSkillEnum();
  (activateTool.inputSchema as Record<string, unknown>).properties = {
    name: {
      type: "string",
      enum: skillIds,
      description: "要激活的技能名称",
    },
  };
}

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
  registerToolHandler("web.search", async (ctx, args) => {
    return webSearch(ctx, String(args.query ?? ""), args.maxResults ? Number(args.maxResults) : 5);
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
  registerToolHandler("skill.activate", async (_ctx, args) => {
    return activateSkill(String(args.name ?? ""));
  });
  registerToolHandler("plan.update", async (_ctx, args) => ({
    ...parsePlanUpdate(args),
  }));
  registerToolHandler("learning.goal.upsert", async (ctx, args) => {
    const projectId = requireLearningProject(ctx.projectId);
    const goal = await learningService.createGoal({
      userId: ctx.userId,
      projectId,
      input: {
        title: String(args.title ?? ""),
        ...(args.purpose ? { purpose: String(args.purpose) } : {}),
        ...(args.targetDate ? { targetDate: String(args.targetDate) } : {}),
        ...(args.dailyMinutes
          ? { dailyMinutes: Number(args.dailyMinutes) }
          : {}),
        activate: true,
        idempotencyKey: String(args.idempotencyKey ?? ""),
      },
    });
    return { goal };
  });
  registerToolHandler("learning.map.generate", async (ctx, args) => {
    const projectId = requireLearningProject(ctx.projectId);
    const map = await learningService.generateMap({
      userId: ctx.userId,
      projectId,
      goalId: String(args.goalId ?? ""),
      input: { idempotencyKey: String(args.idempotencyKey ?? "") },
    });
    return { map };
  });
  registerToolHandler("learning.practice.create", async (ctx, args) => {
    const projectId = requireLearningProject(ctx.projectId);
    const session = await learningService.createDiagnosticSession({
      userId: ctx.userId,
      projectId,
      goalId: String(args.goalId ?? ""),
      input: { idempotencyKey: String(args.idempotencyKey ?? "") },
    });
    return { session };
  });
  registerToolHandler("learning.attempt.submit", async (ctx, args) => {
    const projectId = requireLearningProject(ctx.projectId);
    const input = practiceAttemptSubmissionSchema.parse({
      answer: args.answer,
      idempotencyKey: String(args.idempotencyKey ?? ""),
    });
    const result = await learningService.submitAttempt({
      userId: ctx.userId,
      projectId,
      sessionId: String(args.sessionId ?? ""),
      sessionItemId: String(args.sessionItemId ?? ""),
      input,
    });
    return { result };
  });
  registerToolHandler("learning.review.next", async (ctx, args) => {
    const projectId = requireLearningProject(ctx.projectId);
    const session = await learningService.createReviewSession({
      userId: ctx.userId,
      projectId,
      goalId: String(args.goalId ?? ""),
      input: {
        limit: Math.min(50, Math.max(1, Number(args.limit ?? 10))),
        idempotencyKey: String(args.idempotencyKey ?? ""),
      },
    });
    return { session };
  });
  registerToolHandler("learning.progress.read", async (ctx, args) => {
    const projectId = requireLearningProject(ctx.projectId);
    return learningService.getProgress({
      userId: ctx.userId,
      projectId,
      goalId: String(args.goalId ?? ""),
    });
  });

  // Discovery may not have run at module-load time; ensureDiscovery refreshes
  // this schema again after it replaces the skill registry.
  refreshActivateSkillSchema();
}

// 模块副作用注册：导入即生效
registerBuiltinTools();

function requireLearningProject(projectId: string | undefined): string {
  if (!projectId) {
    throw new Error("学习工具只能在已验证的项目上下文中运行");
  }
  return projectId;
}
