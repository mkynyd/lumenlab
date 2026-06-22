/**
 * 数据库种子脚本 — 导入 UserRole 初始数据。
 *
 * 使用: npx tsx prisma/seed.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

interface SeedRole {
  key: string;
  label: string;
  description?: string;
  applicableModes: string[];
  classifierHints: Record<string, unknown>;
  systemPromptAddition: string;
  recommendedQuickActions?: Array<{ title: string; prompt: string }>;
  priority: number;
  isActive: boolean;
}

async function main() {
  const filePath = path.join(__dirname, "seeds/user-roles.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const roles: SeedRole[] = JSON.parse(raw);

  console.log(`Seeding ${roles.length} UserRole entries...`);

  for (const role of roles) {
    await prisma.userRole.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        label: role.label,
        description: role.description,
        applicableModes: role.applicableModes,
        classifierHints: role.classifierHints,
        systemPromptAddition: role.systemPromptAddition,
        recommendedQuickActions: role.recommendedQuickActions,
        priority: role.priority,
        isActive: role.isActive,
      },
      update: {
        label: role.label,
        description: role.description,
        applicableModes: role.applicableModes,
        classifierHints: role.classifierHints,
        systemPromptAddition: role.systemPromptAddition,
        recommendedQuickActions: role.recommendedQuickActions,
        priority: role.priority,
        isActive: role.isActive,
        version: { increment: 1 },
      },
    });
    console.log(`  ✓ ${role.key}`);
  }

  console.log(`Done. ${roles.length} roles seeded.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
