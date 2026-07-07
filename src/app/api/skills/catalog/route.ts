/**
 * Skill Catalog API
 *
 * GET /api/skills/catalog
 *
 * 返回当前用户可用的 skill 列表（分类结构），供前端 SkillSelector 及其他 UI 消费。
 * 数据来源：skillRegistry（内存中由 discovery 或旧 manifest 填充）。
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { skillRegistry } from "@/lib/agent/skill-registry";
import { ensureDiscovery } from "@/lib/skills/registry";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 延迟初始化：首次 API 请求时触发 discovery
  await ensureDiscovery();

  const skills = skillRegistry.list();

  // 按 category 分组
  const categoryMap = new Map<
    string,
    {
      slug: string;
      displayName: string;
      skills: Array<{
        name: string;
        displayName: string;
        description: string;
        version: string;
        source: string;
        riskSummary: {
          ceiling: string;
          approval: string;
          external: boolean;
        };
      }>;
    }
  >();

  const CATEGORY_LABELS: Record<string, string> = {
    academic: "论文学术",
    exam: "考试复习",
    coding: "编程技术",
    learning: "通识学习",
    uncategorized: "未分类",
  };

  for (const skill of skills) {
    const catSlug = skill.category || "uncategorized";
    let cat = categoryMap.get(catSlug);
    if (!cat) {
      cat = {
        slug: catSlug,
        displayName: CATEGORY_LABELS[catSlug] || catSlug,
        skills: [],
      };
      categoryMap.set(catSlug, cat);
    }

    cat.skills.push({
      name: skill.skillId,
      displayName: skill.displayName || skill.skillId,
      description: skill.description,
      version: skill.version,
      source: skill.category ? "builtin" : "legacy",
      riskSummary: {
        ceiling: maxRiskLevel(skill.allowedRiskLevel),
        approval: skill.defaultApprovalPolicy,
        external: skill.dataHandlingPolicy?.maySendToExternal ?? false,
      },
    });
  }

  // 按分类排序（保持 INDEX.md 定义的顺序）
  const categoryOrder = ["academic", "exam", "coding", "learning", "uncategorized"];
  const categories = categoryOrder
    .filter((slug) => categoryMap.has(slug))
    .map((slug) => categoryMap.get(slug)!);

  return NextResponse.json({
    categories,
    totalCount: skills.length,
  });
}

function maxRiskLevel(levels: string[]): string {
  if (!levels || levels.length === 0) return "L1";
  const rank: Record<string, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
  let max = "L1";
  let maxR = 1;
  for (const l of levels) {
    const r = rank[l] ?? 0;
    if (r > maxR) { maxR = r; max = l; }
  }
  return max;
}
