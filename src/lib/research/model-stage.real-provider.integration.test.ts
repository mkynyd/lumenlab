// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { runResearchModelStage } from "./model-stage";

const enabled = process.env.RESEARCH_REAL_PROVIDER_E2E === "1" && Boolean(process.env.RESEARCH_E2E_USER_ID);

describe("real Research provider stage", () => {
  it.runIf(enabled)("runs a structured evaluator call through the existing Runtime and cleans up its system conversation", async () => {
    const userId = process.env.RESEARCH_E2E_USER_ID!;
    const conversation = await prisma.conversation.create({
      data: {
        userId,
        title: "Research Provider E2E",
        model: process.env.RESEARCH_MODEL_RESEARCH_EVALUATOR ?? "deepseek-flash",
        thinkingEnabled: false,
        kind: "research-system",
      },
      select: { id: true },
    });
    try {
      vi.stubEnv("AGENT_RESPONSES_DEEPSEEK_ENABLED", "false");
      const paused = await runResearchModelStage({
        role: "research.evaluator",
        userId,
        conversationId: conversation.id,
        projectId: null,
        signal: AbortSignal.timeout(30_000),
        prompt: "只返回 JSON：{\"status\":\"resolved\"}",
      });
      expect(paused).toMatchObject({ attempted: true, value: null });

      vi.stubEnv("AGENT_RESPONSES_DEEPSEEK_ENABLED", "true");
      const result = await runResearchModelStage({
        role: "research.evaluator",
        userId,
        conversationId: conversation.id,
        projectId: null,
        signal: AbortSignal.timeout(90_000),
        prompt: [
          "只返回 JSON，不要 Markdown，不要隐藏推理。",
          "格式：{\"status\":\"resolved\",\"coverage\":1,\"directness\":1,\"gap\":\"\",\"followUpQueries\":[]}",
          "已有 Evidence：某官方规范明确写出测试结论。",
          "请判断该 Evidence 是否直接支持这个简单判断。",
        ].join("\n"),
      });
      expect(result.attempted).toBe(true);
      expect(result.value).toMatchObject({ status: "resolved" });
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
      console.log(JSON.stringify({
        recovery: "provider_pause_to_completed",
        model: result.model,
        totalTokens: result.usage?.totalTokens ?? 0,
      }));
    } finally {
      vi.unstubAllEnvs();
      await prisma.conversation.delete({ where: { id: conversation.id } });
    }
  }, 120_000);
});
