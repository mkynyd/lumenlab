import { z } from "zod";

export const apiKeySchema = z.object({
  provider: z.enum(["deepseek", "minimax"]),
  key: z
    .string()
    .min(1, "请输入 API Key")
    .max(256, "API Key 长度超出限制")
    .refine((k) => !/\s/.test(k), "API Key 不能包含空白字符"),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1, "消息不能为空").max(200000),
  model: z.enum(["deepseek-v4-pro", "deepseek-v4-flash"]),
  thinkingEnabled: z.boolean().default(false),
  reasoningEffort: z.enum(["high", "max"]).default("high"),
  // Project context (optional — preserves backward compatibility)
  projectId: z.string().optional(),
  selectedFileIds: z.array(z.string().min(1).max(100)).max(50).optional(),
  mode: z.enum(["experiment", "review", "coding", "general"]).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少需要 8 个字符").max(128),
});

export const registerSchema = loginSchema.extend({
  name: z.string().min(1, "昵称不能为空").max(100).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
