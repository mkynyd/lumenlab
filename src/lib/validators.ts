import { z } from "zod";
import { normalizeEmail, parseLoginIdentifier } from "@/lib/auth/identifier";
import { ALL_CHAT_MODELS, DEFAULT_CHAT_MODEL, isChatModelEnabled } from "@/lib/chat/model-catalog";

export const sendMessageSchema = z.object({
  clientRunKey: z.string().uuid().optional(),
  conversationId: z.string().optional(),
  message: z.string().min(1, "消息不能为空").max(200000),
  hiddenPrompt: z.string().min(1).max(200000).optional(),
  model: z
    .enum(ALL_CHAT_MODELS)
    .prefault(DEFAULT_CHAT_MODEL)
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

// Phase 1 clients may still submit email; Contract after those clients retire.
const identifierFields = {
  identifier: z.string().max(254).transform((value) => parseLoginIdentifier(value)?.providerAccountId ?? value).optional(),
  email: z.string().max(254).transform(normalizeEmail).optional(),
};
function validIdentifier(value: { identifier?: string; email?: string }) {
  return parseLoginIdentifier(value.identifier ?? value.email) !== null;
}
export const loginSchema = z.object({
  ...identifierFields,
  password: z.string().min(8, "密码至少需要 8 个字符").max(128),
}).refine(validIdentifier, { path: ["identifier"], message: "请输入有效的邮箱或大陆手机号" });
export const registerSchema = z.object({
  ...identifierFields,
  password: z.string().min(8, "密码至少需要 8 个字符").max(128),
  ticket: z.string().min(1, "缺少身份验证票据").max(200, "身份验证票据无效"),
}).refine(validIdentifier, { path: ["identifier"], message: "请输入有效的邮箱或大陆手机号" });
export const verifyCodeSchema = z.object({
  ...identifierFields,
  code: z.string().regex(/^\d{6}$/, "验证码应为 6 位数字"),
}).refine(validIdentifier, { path: ["identifier"], message: "请输入有效的邮箱或大陆手机号" });
export const verifySendSchema = z.object(identifierFields)
  .refine(validIdentifier, { path: ["identifier"], message: "请输入有效的邮箱或大陆手机号" });
// Password recovery remains email-only in Phase 2.
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email("邮箱格式不正确") });

// 密码重设：ticket 即邮件中的一次性 token
export const resetPasswordSchema = z.object({
  ticket: z.string().min(1, "缺少重设凭证").max(200, "重设凭证无效"),
  password: z.string().min(8, "密码至少需要 8 个字符").max(128),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
