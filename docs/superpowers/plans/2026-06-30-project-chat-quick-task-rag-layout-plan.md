# 项目对话快捷任务 RAG 与布局修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复项目对话中连续提问布局重叠、快捷任务无法正确调用项目文档、二次快捷任务不立即刷新的三个问题。

**Architecture:** 保留现有 `VirtualMessageList` 虚拟列表架构，通过收尾 stale streaming placeholder 和增强 measure 时机解决布局与刷新问题；通过新增 `isQuickTask` 标识穿透到 skill router 和 legacy RAG 路径，强制快捷任务在项目中使用资料上下文。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, TanStack Virtual, Prisma, Vitest.

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|---|---|---|
| `src/lib/validators.ts` | 请求体验证 schema | 新增 `isQuickTask` 字段 |
| `src/lib/hooks/use-chat.ts` | 客户端聊天状态管理 | 新增 `isQuickTask` 到 `SendMessageInput`；收尾 stale streaming placeholder |
| `src/lib/chat-request.ts` | 构造聊天请求体 | 透传 `isQuickTask` |
| `src/app/(chat)/projects/[id]/page.tsx` | 项目页容器 | 快捷任务发送时设置 `isQuickTask: true` |
| `src/app/api/chat/route.ts` | 聊天 API 路由 | 解析 `isQuickTask` 并传给 skill router 和 legacy RAG |
| `src/lib/agent/skill-router.ts` | 技能/任务画像路由 | 快捷任务 + projectId 强制 `profile: "rag"` |
| `src/lib/rag/vector-store.ts` | Legacy RAG 上下文检索 | `shouldUseProjectContext` / `retrieveProjectContext` 支持 `forceProjectContext` |
| `src/components/chat/virtual-message-list.tsx` | 虚拟消息列表 | `messages.length` 变化后强制重新测量 |
| `src/components/chat/message-bubble.tsx` | 单条消息气泡 | 确认已 memo，无需改动 |
| `src/lib/agent/skill-router.test.ts` | Skill router 单元测试 | 新增 quick task 测试 |
| `src/lib/rag/retrieve-context.test.ts` | RAG 检索单元测试 | 新增 force context 测试 |
| `src/lib/chat-request.test.ts` | 请求体构造测试 | 新增 `isQuickTask` 透传测试（如该文件不存在则创建） |

---

## Task 1: 扩展请求类型与验证 schema

**Files:**
- Modify: `src/lib/validators.ts:3-27`
- Modify: `src/lib/hooks/use-chat.ts:59-66`
- Modify: `src/lib/chat-request.ts:3-16`
- Test: `src/lib/chat-request.test.ts`（如不存在则创建）

- [ ] **Step 1: 在 `sendMessageSchema` 中新增 `isQuickTask` 字段**

```typescript
export const sendMessageSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1, "消息不能为空").max(200000),
  hiddenPrompt: z.string().min(1).max(200000).optional(),
  model: z.enum(["deepseek-v4-pro", "deepseek-v4-flash", "minimax-m3"]),
  thinkingEnabled: z.boolean().default(true),
  reasoningEffort: z.enum(["high", "max"]).default("high"),
  // Project context (optional — preserves backward compatibility)
  projectId: z.string().optional(),
  selectedFileIds: z.array(z.string().min(1).max(100)).max(50).optional(),
  mode: z.enum(["experiment", "review", "coding", "general"]).optional(),
  webSearchActive: z.boolean().default(false),
  // Agent Orchestrator manual controls
  manualSkillId: z
    .enum([
      "paper-reader",
      "paper-writer",
      "exam-extract",
      "exam-coach",
      "code-reader",
      "socratic-tutor",
    ])
    .optional(),
  skillOff: z.boolean().default(false),
  // Quick task flag: always treat as project-context task
  isQuickTask: z.boolean().default(false),
});
```

- [ ] **Step 2: 在 `SendMessageInput` 中新增 `isQuickTask`**

```typescript
export interface SendMessageInput {
  content: string;
  hiddenPrompt?: string;
  attachments?: FileAttachment[];
  webSearchActive?: boolean;
  manualSkillId?: string;
  skillOff?: boolean;
  isQuickTask?: boolean;
}
```

- [ ] **Step 3: 在 `ChatRequestInput` 中新增 `isQuickTask` 并透传**

```typescript
export interface ChatRequestInput {
  conversationId?: string;
  message: string;
  hiddenPrompt?: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  projectId?: string;
  selectedFileIds?: string[];
  mode?: ProjectType;
  webSearchActive?: boolean;
  manualSkillId?: string;
  skillOff?: boolean;
  isQuickTask?: boolean;
}
```

在 `buildChatRequestBody` 末尾、返回 `body` 之前加入：

```typescript
  if (input.isQuickTask) {
    body.isQuickTask = true;
  }
```

- [ ] **Step 4: 编写/更新 `chat-request.test.ts` 验证透传**

```typescript
import { describe, it, expect } from "vitest";
import { buildChatRequestBody } from "./chat-request";

describe("buildChatRequestBody", () => {
  it("透传 isQuickTask", () => {
    const body = buildChatRequestBody({
      message: "快捷任务：总结要点",
      hiddenPrompt: "请总结项目资料要点",
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      projectId: "proj-123",
      isQuickTask: true,
    });
    expect(body.isQuickTask).toBe(true);
  });

  it("非快捷任务不包含 isQuickTask", () => {
    const body = buildChatRequestBody({
      message: "你好",
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
    });
    expect(body.isQuickTask).toBeUndefined();
  });
});
```

- [ ] **Step 5: 运行新增/相关测试**

Run: `npm test -- src/lib/chat-request.test.ts`
Expected: PASS

---

## Task 2: 项目页快捷任务发送时设置 `isQuickTask`

**Files:**
- Modify: `src/app/(chat)/projects/[id]/page.tsx:441-449`

- [ ] **Step 1: 修改 `handleQuickTaskSend`**

```typescript
async function handleQuickTaskSend(input: QuickTaskSendInput) {
  setChatInputValue("");
  await sendOrQueue(
    withSkillSelection({
      content: input.label,
      hiddenPrompt: input.prompt,
      isQuickTask: true,
    })
  );
}
```

- [ ] **Step 2: 编译检查**

Run: `npm run type-check`
Expected: 无类型错误

---

## Task 3: API 路由解析并透传 `isQuickTask`

**Files:**
- Modify: `src/app/api/chat/route.ts:157-169`
- Modify: `src/app/api/chat/route.ts:232-259`
- Modify: `src/app/api/chat/route.ts:343-357`

- [ ] **Step 1: 从 body 解构 `isQuickTask`**

在 route.ts 的解构中加入 `isQuickTask`：

```typescript
const {
  conversationId,
  message,
  hiddenPrompt,
  model,
  thinkingEnabled,
  reasoningEffort,
  projectId,
  selectedFileIds,
  mode,
  manualSkillId,
  skillOff,
  isQuickTask,
} = body;
```

- [ ] **Step 2: Legacy RAG 路径强制使用项目上下文**

在 `if (project && !agentOrchestratorEnabled)` 块内，修改 `shouldUseProjectContext` 调用和 `retrieveProjectContext` 调用：

```typescript
if (shouldUseProjectContext(effectivePrompt, uniqueFileIds, isQuickTask)) {
  const retrieval = await retrieveProjectContext({
    userId,
    projectId: project.id,
    selectedFileIds: uniqueFileIds,
    query: effectivePrompt,
    maxChars: 60000,
    forceProjectContext: isQuickTask,
    loadQueryEmbedding: async () => {
      try {
        const bailianKey = await getProviderApiKey(userId, "bailian");
        return await embedQuery(effectivePrompt, bailianKey);
      } catch {
        return undefined;
      }
    },
  });
  // ... 后续保持不变
}
```

- [ ] **Step 3: 把 `isQuickTask` 传给 `routeSkill`**

```typescript
const skillRoute = routeSkill({
  message,
  hiddenPrompt,
  projectId: project?.id,
  selectedFileIds: uniqueFileIds,
  selectedFiles: selectedFiles.map((file) => ({
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
  })),
  webSearchActive: body.webSearchActive,
  manualSkillId: manualSkillId || null,
  skillOff: skillOff || false,
  skillDisabled: conversation.skillDisabled || false,
  isQuickTask: isQuickTask || false,
});
```

- [ ] **Step 4: 编译检查**

Run: `npm run type-check`
Expected: 无类型错误

---

## Task 4: Skill Router 快捷任务强制 `profile: "rag"`

**Files:**
- Modify: `src/lib/agent/skill-router.ts:17-28`
- Modify: `src/lib/agent/skill-router.ts:104-113`
- Test: `src/lib/agent/skill-router.test.ts`

- [ ] **Step 1: 在 `SkillRouteInput` 中新增 `isQuickTask`**

```typescript
export interface SkillRouteInput {
  message: string;
  hiddenPrompt?: string;
  manualSkillId?: string | null;
  previousActiveSkillId?: string | null;
  projectId?: string | null;
  selectedFileIds?: string[];
  selectedFiles?: RoutingFileSignal[];
  webSearchActive?: boolean;
  skillOff?: boolean;
  skillDisabled?: boolean;
  isQuickTask?: boolean;
}
```

- [ ] **Step 2: 在 `inferProfile` 中添加强制 rag 逻辑**

```typescript
function inferProfile(input: SkillRouteInput, skillId: string | null): TaskProfile {
  if (input.isQuickTask && input.projectId) return "rag";
  if (skillId === "paper-reader") return "research";
  if (skillId === "paper-writer") return "workflow";
  if (skillId === "exam-extract" || skillId === "exam-coach") return "rag";
  if (skillId === "code-reader") return hasSelectedContext(input) ? "rag" : "simple";
  if (input.webSearchActive) return "research";
  if (hasSelectedContext(input)) return "rag";
  if (input.projectId && needsProjectMaterial(input)) return "rag";
  return "simple";
}
```

- [ ] **Step 3: 在 `skill-router.test.ts` 中新增测试**

```typescript
import { describe, it, expect } from "vitest";
import { routeSkill } from "./skill-router";

describe("routeSkill quick task", () => {
  it("项目中的快捷任务强制返回 rag profile，即使 prompt 不含资料关键词", () => {
    const result = routeSkill({
      message: "快捷任务：总结要点",
      hiddenPrompt: "请总结要点",
      projectId: "proj-123",
      isQuickTask: true,
    });
    expect(result.profile).toBe("rag");
  });

  it("非快捷任务且不含资料关键词时保持 simple", () => {
    const result = routeSkill({
      message: "你好",
      projectId: "proj-123",
    });
    expect(result.profile).toBe("simple");
  });
});
```

- [ ] **Step 4: 运行 skill-router 测试**

Run: `npm test -- src/lib/agent/skill-router.test.ts`
Expected: PASS

---

## Task 5: Legacy RAG 支持 `forceProjectContext`

**Files:**
- Modify: `src/lib/rag/vector-store.ts:86-93`
- Modify: `src/lib/rag/vector-store.ts:278-284`
- Modify: `src/lib/rag/vector-store.ts:785`
- Test: `src/lib/rag/retrieve-context.test.ts`

- [ ] **Step 1: 在 `RetrieveProjectContextParams` 中新增 `forceProjectContext`**

```typescript
export interface RetrieveProjectContextParams {
  userId: string;
  projectId: string;
  selectedFileIds: string[];
  query: string;
  maxChars: number;
  loadQueryEmbedding?: () => Promise<number[] | undefined>;
  forceProjectContext?: boolean;
}
```

- [ ] **Step 2: 修改 `shouldUseProjectContext` 签名与逻辑**

```typescript
export function shouldUseProjectContext(
  query: string,
  selectedFileIds: string[] = [],
  forceProjectContext: boolean = false
) {
  if (forceProjectContext) return true;
  if (selectedFileIds.length > 0) return true;
  return hasAnyPattern(query, PROJECT_CONTEXT_PATTERNS) || isCorpusWideTask(query);
}
```

- [ ] **Step 3: 在 `retrieveProjectContext` 中使用新参数**

将内部的调用改为：

```typescript
if (!shouldUseProjectContext(params.query, selectedFileIds, params.forceProjectContext)) {
  // ... 保持不变
}
```

- [ ] **Step 4: 在 `retrieve-context.test.ts` 中新增测试**

```typescript
import { describe, it, expect } from "vitest";
import { shouldUseProjectContext } from "./vector-store";

describe("shouldUseProjectContext", () => {
  it("forceProjectContext 为 true 时直接返回 true", () => {
    expect(shouldUseProjectContext("你好", [], true)).toBe(true);
  });

  it("无 force、无选中、无关键词时返回 false", () => {
    expect(shouldUseProjectContext("你好", [], false)).toBe(false);
  });
});
```

- [ ] **Step 5: 运行 retrieve-context 测试**

Run: `npm test -- src/lib/rag/retrieve-context.test.ts`
Expected: PASS

---

## Task 6: 收尾 stale streaming placeholder

**Files:**
- Modify: `src/lib/hooks/use-chat.ts:162-174`

- [ ] **Step 1: 在追加新消息前先收尾现有的 streaming assistant**

将：

```typescript
      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: streamingId,
          role: "assistant",
          content: "",
          reasoningContent: null,
          isStreaming: true,
          streamingSource: "foreground",
          streamingStartedAt,
        },
      ]);
```

改为：

```typescript
      setMessages((prev) => [
        ...prev.map((m) =>
          m.isStreaming
            ? {
                ...m,
                isStreaming: false,
                streamingSource: undefined,
                streamingStartedAt: undefined,
              }
            : m
        ),
        userMessage,
        {
          id: streamingId,
          role: "assistant",
          content: "",
          reasoningContent: null,
          isStreaming: true,
          streamingSource: "foreground",
          streamingStartedAt,
        },
      ]);
```

- [ ] **Step 2: 编译检查**

Run: `npm run type-check`
Expected: 无类型错误

---

## Task 7: 虚拟列表在消息数量变化后强制重新测量

**Files:**
- Modify: `src/components/chat/virtual-message-list.tsx:179-211`

- [ ] **Step 1: 在 `VirtualMessageList` 中新增 `messages.length` 监听 effect**

在现有 `useEffect` 之后（或之前）添加：

```typescript
  // Force re-measure when message count changes, so newly added user/assistant
  // messages get their actual DOM height computed before the next paint.
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      virtualizer.measure();
    });
    return () => cancelAnimationFrame(rafId);
  }, [messages.length, virtualizer]);
```

- [ ] **Step 2: 编译检查**

Run: `npm run type-check`
Expected: 无类型错误

---

## Task 8: 确认 `MessageBubble` 已 memo

**Files:**
- Read: `src/components/chat/message-bubble.tsx:320-340`

- [ ] **Step 1: 检查导出是否为 `memo(...)`**

确认文件末尾类似：

```typescript
export const MessageBubble = memo(
  MessageBubbleComponent,
  (previous, next) => {
    if (previous.id !== next.id || previous.isStreaming !== next.isStreaming) {
      return false;
    }
    // ... 其余比较逻辑
  }
);
```

- [ ] **Step 2: 如已 memo 则无需改动**

如未 memo，则在最下方将默认导出替换为 `memo(MessageBubbleComponent)` 并补充比较函数。

---

## Task 9: 全量测试与 lint

- [ ] **Step 1: 运行单元测试**

Run: `npm test`
Expected: 全部通过（允许现有失败，但新增测试必须通过）

- [ ] **Step 2: 运行 lint**

Run: `npm run lint`
Expected: 无新增错误

- [ ] **Step 3: 运行类型检查**

Run: `npm run type-check`
Expected: 无类型错误

---

## Task 10: 浏览器验证（使用 Kimi WebBridge）

- [ ] **Step 1: 启动开发服务器**

Run: `cd /Users/yinjunhang/Documents/course-ai-lab/light-ai-chat && npm run dev`
Wait: 服务启动后访问 `http://localhost:3000`

- [ ] **Step 2: 登录并进入“网络安全”项目**

使用 Kimi WebBridge 导航到项目页，确认已上传文件可见。

- [ ] **Step 3: 验证 RAG 问题 2**

- 不选中任何文件，点击通用快捷任务“总结要点”。
- 观察 AI 回复是否引用了项目资料。
- 在服务端日志中确认 `profile` 为 `rag`，且调用了 `project_rag.search`。
- 选中多个文件，再次点击快捷任务，确认调用 `project_files.read` 读取选中文件。

- [ ] **Step 4: 验证布局问题 1**

- 连续发送 2-3 个问题，观察用户气泡与 AI 气泡是否重叠。
- 在第一条 AI 回复未结束时发送第二条，确认旧 placeholder 被收尾。

- [ ] **Step 5: 验证刷新问题 3**

- 发送一个快捷任务，等 AI 完全回复结束。
- 点击另一个快捷任务，确认新的“快捷任务：xxx”用户消息立即出现在对话区域。

- [ ] **Step 6: 截图留档**

对关键验证结果截图，保存到 `/Users/yinjunhang/Documents/course-ai-lab/light-ai-chat/docs/superpowers/verification/2026-06-30-project-chat-fixes/`。

---

## Self-Review Checklist

- [ ] **Spec coverage:**
  - 布局问题 1：Task 6（收尾 placeholder）+ Task 7（重新测量）覆盖。
  - RAG 问题 2：Task 1-5 覆盖 isQuickTask 透传与强制 rag/force context。
  - 刷新问题 3：Task 6-7 覆盖。
- [ ] **Placeholder scan:** 计划中没有 TBD/TODO/"后续补充"。
- [ ] **Type consistency:** `isQuickTask` 在 schema、interface、body builder、router、skill router、vector-store 中命名一致。
- [ ] **No git commit:** 本阶段不执行 `git commit`，待全部任务完成后再统一提交。
