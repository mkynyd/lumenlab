/**
 * 内置工具注册
 *
 * 集中声明 Tool 元数据 + 把 handler 挂到 Tool Executor。
 * 任何模块只需 `import "@/lib/tools/registry";` 即可触发注册（副作用导入）。
 *
 * 风险等级（与 plan 对齐）：
 *   L1 — project_files.list / read、artifact.list、web.search、web.fetch、
 *         arxiv.search、arxiv.read、arxiv.fetch、sciverse.search、
 *         sciverse.semantic_search、sciverse.read、reference.list、reference.format
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
import { sciversePaperRelations, sciverseRead, sciverseResource, sciverseSearch, sciverseSemanticSearch } from "./sciverse/handlers";
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
    description:
      "读取已解析项目资料的文本内容。长文档默认只返回开头一部分；返回的 nextOffset 不为 null 时，可传 offset=nextOffset 继续读取后续内容。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        fileId: { type: "string" },
        maxChars: { type: "integer" },
        offset: { type: "integer" },
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
    description: [
      "LumenLab 的统一联网搜索能力，平台自有搜索栈（AnySearch 优先，Bing RSS 与 DuckDuckGo 兜底），与当前对话模型无关。",
      "返回标题、摘要与原始 URL 来源；需要阅读网页全文时再调用 web.fetch。",
      "可选 tag 用于选择 AnySearch 能力：general.general、academic.search、academic.preprint、academic.dataset、code.snippet 可直接使用；code.doc 需同时给出 params.library，academic.citation 需 params.id，security.vuln 需 params.type 与 params.value。",
      "不确定 tag 时请省略，让 AnySearch 自行路由；不要猜测不存在的 tag。zone 仅在明确需要特定区域资料时提供（cn 或 intl），中文问题也可能需要国际资料。",
    ].join(""),
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索查询，一句话表达一个意图" },
        maxResults: { type: "integer", description: "返回条数，服务端限制为 1-10" },
        tag: { type: "string", description: "可选能力标签（如 academic.search）；不确定时省略" },
        zone: { type: "string", enum: ["cn", "intl"], description: "可选区域偏好；不确定时省略" },
        language: { type: "string", description: "可选结果语言，例如 zh-CN、en" },
        params: { type: "object", description: "可选能力参数对象，例如 {\"library\":\"react\"}；不确定时省略" },
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
    toolId: "sciverse.search",
    name: "Sciverse 论文元数据检索",
    description: [
      "Search the Sciverse academic paper corpus by structured metadata and BM25 keywords: DOI, title, author, journal, publication year, subjects. ",
      "Every result carries a uniqueId (stable metadata identifier, always present) and optionally a docId (full-text content hash, present only when full text exists). ",
      "Metadata in the result does not mean the full text is readable: only papers with isContentAccessible=true can be opened via sciverse.read with their docId. ",
      "Use sciverse.semantic_search for natural-language research questions instead of keyword queries.",
    ].join(""),
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "BM25 keyword query over title/abstract/venue; omit for pure structured filtering" },
        titleContains: { type: "string", description: "Word that must appear in the title" },
        abstractContains: { type: "string", description: "Word that must appear in the abstract" },
        authors: { type: "array", items: { type: "string" }, description: "Author names; any match counts" },
        journals: { type: "array", items: { type: "string" }, description: "Normalized venue names; any match counts" },
        subjects: { type: "array", items: { type: "string" }, description: "Subject categories such as \"computer science\"" },
        yearFrom: { type: "integer", description: "Earliest publication year (inclusive)" },
        yearTo: { type: "integer", description: "Latest publication year (inclusive)" },
        freshnessBoost: { type: "string", enum: ["NONE", "MILD", "STRONG"], description: "Recency soft-weighting; only effective with query" },
        impactBoost: { type: "string", enum: ["NONE", "MILD", "STRONG"], description: "Citation-impact soft-weighting; only effective with query" },
        languageAffinity: { type: "string", enum: ["NONE", "MILD", "STRONG"], description: "Language soft-weighting inferred from the query; only effective with query" },
        sortByYear: { type: "string", enum: ["auto", "desc", "asc", "none"], description: "Year sorting; never combined with query (relevance ranking is kept)" },
        page: { type: "integer", description: "Page number starting at 1" },
        pageSize: { type: "integer", description: "Results per page, clamped to 1-25, default 10" },
        filterIntent: {
          type: "object",
          description: [
            "High-level structured filter intent resolved by the server against the live Sciverse field catalog. ",
            "You never provide field names, operators or raw query JSON — only these semantic keys. ",
            "Unknown keys are rejected; keys the current catalog cannot serve are dropped (never sent upstream) and reported back in advancedFilters.dropped. ",
          ].join(""),
          properties: {
            openAccess: { type: "boolean", description: "Restrict to (or exclude) open-access records" },
            oaStatus: { type: "array", items: { type: "string", enum: ["gold", "hybrid", "bronze", "green", "closed", "diamond"] }, description: "Open-access status" },
            venueTypes: { type: "array", items: { type: "string", enum: ["journal", "conference", "repository", "book series", "ebook platform", "metadata", "other"] }, description: "Publication venue type" },
            publicationTypes: { type: "array", items: { type: "string" }, description: "Work type such as article / review / preprint / conference" },
            resourceTypes: { type: "array", items: { type: "string", enum: ["paper", "ebook"] }, description: "Metadata source type" },
            languages: { type: "array", items: { type: "string" }, description: "Language codes such as en, zh" },
            publishers: { type: "array", items: { type: "string" }, description: "Publisher names" },
            keywords: { type: "array", items: { type: "string" }, description: "Fuzzy keyword match on the paper keyword list" },
            doi: { type: "string", description: "Exact DOI match (server normalizes the value)" },
            citedBy: { type: "string", description: "Reverse citation lookup: papers citing this unique_id (unbounded-citation escape hatch)" },
            topPercentile: { type: "string", enum: ["top_1_percent", "top_10_percent"], description: "Citation percentile band" },
            citationCountMin: { type: "integer" },
            citationCountMax: { type: "integer" },
            influentialCitationCountMin: { type: "integer" },
            influentialCitationCountMax: { type: "integer" },
            fwciMin: { type: "number", description: "Field-Weighted Citation Impact lower bound" },
            fwciMax: { type: "number" },
            referenceCountMin: { type: "integer" },
            referenceCountMax: { type: "integer" },
            publishedFrom: { type: "string", description: "Publication date lower bound, YYYY[-MM[-DD]]" },
            publishedTo: { type: "string", description: "Publication date upper bound, YYYY[-MM[-DD]]" },
          },
        },
      },
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
    toolId: "sciverse.semantic_search",
    name: "Sciverse 段落级证据检索",
    description: [
      "Retrieve passage-level evidence chunks for a natural-language research question from the Sciverse full-text corpus. ",
      "Filters are SOFT semantics (except docIds): chunks whose metadata is missing may not be excluded, so never treat soft-filter results as an absolute coverage guarantee. ",
      "To strictly scope the corpus, first call sciverse.search to collect doc_id values, then pass them as filters.docIds — docIds is the only hard constraint. ",
      "An explicit empty docIds array means an empty corpus and returns zero hits; it does not fall back to a global search. ",
      "Each hit carries docId and offset; call sciverse.read(docId, offset) to read the original text around the evidence.",
    ].join(""),
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language research question, 1-4096 characters" },
        topK: { type: "integer", description: "Max hits, clamped to 1-100, default 10" },
        mode: { type: "string", enum: ["fast", "balanced", "quality"], description: "fast = keyword-only recall; balanced (default) = hybrid; quality = LLM query rewrite + hybrid (slower)" },
        sourceTypes: { type: "array", items: { type: "string", enum: ["web", "pdf"] }, description: "Restrict chunk source types" },
        filters: {
          type: "object",
          description: "Soft filters (except docIds, which is a hard scope). Missing chunk metadata is not excluded by soft filters.",
          properties: {
            lang: { type: "string", description: "Language code such as en or zh" },
            author: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
            venue: { type: "string", description: "Normalized venue name" },
            venueType: { type: "string", description: "journal / conference / repository / ..." },
            yearFrom: { type: "integer" },
            yearTo: { type: "integer" },
            dateFrom: { type: "string", description: "YYYY[-MM[-DD]]" },
            dateTo: { type: "string", description: "YYYY[-MM[-DD]]" },
            citationCountMin: { type: "integer" },
            citationCountMax: { type: "integer" },
            influentialCitationCountMin: { type: "integer" },
            influentialCitationCountMax: { type: "integer" },
            topicDomain: { type: "string", enum: ["Physical Sciences", "Social Sciences", "Health Sciences", "Life Sciences"] },
            primaryTopic: { type: "string" },
            docIds: {
              type: "array",
              items: { type: "string" },
              description: "HARD scope: restrict retrieval to these doc_id values (from sciverse.search). An explicit empty array returns zero hits.",
            },
          },
        },
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
    toolId: "sciverse.read",
    name: "Sciverse 原文片段读取",
    description: [
      "Read a bounded slice of a paper's full text by docId (from sciverse.search or sciverse.semantic_search). ",
      "This is a bounded slice read (offset/limit in Unicode code points), not a whole-paper download: read around the evidence offset, then page forward with nextOffset while more is true. ",
      "Only works for papers whose isContentAccessible is true; otherwise expect SCIVERSE_CONTENT_UNAVAILABLE.",
    ].join(""),
    inputSchema: {
      type: "object",
      properties: {
        docId: { type: "string", description: "Full-text content hash from sciverse.search / sciverse.semantic_search" },
        offset: { type: "integer", description: "Start position in Unicode code points, default 0" },
        limit: { type: "integer", description: "Max code points to read, clamped to 1-4000, default 1200" },
      },
      required: ["docId"],
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
    toolId: "sciverse.paper_relations",
    name: "Sciverse 论文引用关系查询",
    description: [
      "List the paper-to-paper scholarly relations of ONE known paper (by its uniqueId from sciverse.search): ",
      "references = works this paper cites (trace origins); citations = later works citing it (verification, follow-ups, corrections); related_works = thematic neighborhood (weakest signal). ",
      "Results are paper identifiers (id + idType + title), NOT evidence: a relation only proves the citation link exists, never that the target supports any claim. ",
      "To use a target as evidence, resolve it via sciverse.search / sciverse.semantic_search and read it with sciverse.read. ",
      "Pagination is bounded: page 1-20, pageSize clamped to 1-50 (default 10); do not crawl all pages of highly-cited papers.",
    ].join(""),
    inputSchema: {
      type: "object",
      properties: {
        uniqueId: { type: "string", description: "Seed paper unique_id (e.g. paper:10.1038/xxx); doc_id is NOT accepted" },
        relation: { type: "string", enum: ["references", "citations", "related_works"], description: "references = cited by the paper; citations = later papers citing it; related_works = thematic neighbors" },
        page: { type: "integer", description: "Page number starting at 1, clamped to 1-20" },
        pageSize: { type: "integer", description: "Items per page, clamped to 1-50, default 10" },
      },
      required: ["uniqueId", "relation"],
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
    toolId: "sciverse.resource",
    name: "Sciverse 论文图表资源读取",
    description: [
      "Fetch one figure/table image embedded in a paper, by the relative path reported in sciverse.read's `resources[].fileName`. ",
      "Use it only when the answer depends on a specific measurement or comparison that lives in a figure or table and the body text is not enough. ",
      "Returns bounded image bytes (base64) plus mimeType/byteLength; oversized or non-image resources return metadata with dataIncluded=false. ",
      "Arbitrary URLs, absolute paths and filesystem paths are rejected. ",
    ].join(""),
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Relative resource path from sciverse.read resources[].fileName (never an absolute path or URL)" },
        docId: { type: "string", description: "Optional doc_id the resource was discovered in, for provenance" },
      },
      required: ["fileName"],
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
      args.maxChars ? Number(args.maxChars) : 8000,
      args.offset ? Number(args.offset) : 0
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
    return webSearch(ctx, String(args.query ?? ""), {
      maxResults: args.maxResults ? Number(args.maxResults) : undefined,
      tag: args.tag ? String(args.tag) : undefined,
      zone: args.zone === "cn" || args.zone === "intl" ? args.zone : undefined,
      language: args.language ? String(args.language) : undefined,
      params: args.params && typeof args.params === "object" && !Array.isArray(args.params) ? (args.params as Record<string, unknown>) : undefined,
    });
  });
  registerToolHandler("web.fetch", async (_ctx, args) => {
    return webFetch(String(args.url ?? ""));
  });
  registerToolHandler("arxiv.search", async (ctx, args) => {
    return arxivSearch(String(args.query ?? ""), args.maxResults ? Number(args.maxResults) : 5, { signal: ctx.signal });
  });
  registerToolHandler("arxiv.read", async (_ctx, args) => {
    return arxivRead(String(args.arxivId ?? ""));
  });
  registerToolHandler("arxiv.fetch", async (_ctx, args) => {
    return arxivFetch(String(args.url ?? ""));
  });
  registerToolHandler("sciverse.search", async (ctx, args) => {
    return sciverseSearch(ctx, args);
  });
  registerToolHandler("sciverse.semantic_search", async (ctx, args) => {
    return sciverseSemanticSearch(ctx, args);
  });
  registerToolHandler("sciverse.read", async (ctx, args) => {
    return sciverseRead(ctx, args);
  });
  registerToolHandler("sciverse.paper_relations", async (ctx, args) => {
    return sciversePaperRelations(ctx, args);
  });
  registerToolHandler("sciverse.resource", async (ctx, args) => {
    return sciverseResource(ctx, args);
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
