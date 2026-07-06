import { z } from "zod";

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
  // 从硬编码 enum 改为 z.string()，运行时由 skillRegistry.has() 校验。
  // Phase 1 保留硬编码 enum 作为编译时文档参考。
  manualSkillId: z.string().optional(),
  skillOff: z.boolean().default(false),
  // Quick task flag: when true, treat as project-context quick task
  isQuickTask: z.boolean().default(false),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少需要 8 个字符").max(128),
});

export const registerSchema = loginSchema.extend({
  registrationCode: z
    .string()
    .min(8, "注册码至少需要 8 个字符")
    .max(128, "注册码长度超出限制"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
