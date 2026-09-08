/**
 * 消息 subtype 过滤助手（任务 08 发现并修复的主线缺陷）。
 *
 * Prisma 在可空列上生成 `subtype <> 'x'`，SQL 里 NULL 比较结果为 NULL，
 * 因此 `{ subtype: { not: "x" } }` 会把所有 `subtype IS NULL` 的普通消息
 * 一并排除——历史上下文、压缩候选与摘要替换标记都因此失效。
 * 这里显式把 NULL 纳入条件，保持"排除某个 subtype"的原意。
 */
export function excludingSubtype(subtype: string) {
  return {
    OR: [{ subtype: null }, { subtype: { not: subtype } }],
  };
}
