import { z } from "zod";
import { ALL_CHAT_MODELS, isChatModelEnabled } from "@/lib/chat/model-catalog";

export const sendMessageSchema = z.object({
  clientRunKey: z.string().uuid().optional(),
  conversationId: z.string().optional(),
  message: z.string().min(1, "消息不能为空").max(200000),
  hiddenPrompt: z.string().min(1).max(200000).optional(),
  model: z
    .enum(ALL_CHAT_MODELS)
    .refine((model) => isChatModelEnabled(model), {
      message: "Qwen 模型暂未开放",
    }),
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
  materialScope: z.enum(["project-corpus", "none"]).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少需要 8 个字符").max(128),
});

// 注册：邮箱验证票据（<challengeId>.<raw>）作为注册凭证，替代注册码
export const registerSchema = loginSchema.extend({
  ticket: z.string().min(1, "缺少邮箱验证票据").max(200, "邮箱验证票据无效"),
});

// 邮箱验证码：6 位数字
export const verifyCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  code: z
    .string()
    .regex(/^\d{6}$/, "验证码应为 6 位数字"),
});

// 发送验证/重设邮件
export const verifySendSchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
});

// 密码重设：ticket 即邮件中的一次性 token
export const resetPasswordSchema = z.object({
  ticket: z.string().min(1, "缺少重设凭证").max(200, "重设凭证无效"),
  password: z.string().min(8, "密码至少需要 8 个字符").max(128),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
