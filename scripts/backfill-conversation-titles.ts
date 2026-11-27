/**
 * 清理历史对话标题中的模型拒答/空泛占位。
 *
 * 背景：旧版标题接口把“信息不足，无法概括”“无法生成标题：首条消息内容不足”
 * 当作正常模型输出写入数据库。新版接口会拒绝这些输出，但历史行仍需一次性修复。
 *
 * 默认 dry-run；确认后加 --apply：
 *   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env \
 *     scripts/backfill-conversation-titles.ts --apply
 */
import { prisma } from "../src/lib/db";
import {
  NEW_CONVERSATION_TITLE,
  conversationBootstrapTitle,
  sanitizeGeneratedTitle,
} from "../src/lib/conversation-title";

async function main() {
  const apply = process.argv.includes("--apply");
  const conversations = await prisma.conversation.findMany({
    select: {
      id: true,
      title: true,
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          content: true,
          attachments: { select: { kind: true, mimeType: true } },
        },
      },
    },
  });

  const candidates = conversations
    .filter(
      (conversation) =>
        conversation.title === NEW_CONVERSATION_TITLE ||
        sanitizeGeneratedTitle(conversation.title) === null
    )
    .map((conversation) => {
      const firstMessage = conversation.messages[0];
      const nextTitle = conversationBootstrapTitle(
        firstMessage?.content ?? "",
        firstMessage?.attachments ?? []
      );
      return {
        id: conversation.id,
        previous: conversation.title,
        next: nextTitle,
      };
    })
    .filter((candidate) => candidate.previous !== candidate.next);

  console.log(
    `[backfill-titles] ${apply ? "APPLY" : "DRY-RUN"}: ${candidates.length} candidate(s)`
  );
  for (const candidate of candidates.slice(0, 20)) {
    console.log(`- ${candidate.id}: ${candidate.previous} -> ${candidate.next}`);
  }
  if (candidates.length > 20) {
    console.log(`... and ${candidates.length - 20} more`);
  }

  if (!apply) {
    console.log("[backfill-titles] no rows changed; rerun with --apply");
    return;
  }

  let updated = 0;
  for (const candidate of candidates) {
    const result = await prisma.conversation.updateMany({
      where: { id: candidate.id, title: candidate.previous },
      data: { title: candidate.next },
    });
    updated += result.count;
  }
  console.log(`[backfill-titles] updated ${updated} row(s)`);
}

main()
  .catch((error) => {
    console.error("[backfill-titles] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
