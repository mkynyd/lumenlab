-- 旧标题接口曾把模型拒答当作正常输出写入 Conversation.title。
-- 这些标题会出现在侧栏导航里，误导用户且无法操作；这里一次性改为
-- 首条用户消息的确定性截断标题（无文本时用附件类型兜底）。
UPDATE "Conversation" AS c
SET "title" = COALESCE(
  NULLIF(
    LEFT(
      BTRIM(
        REGEXP_REPLACE(
          (
            SELECT m."content"
            FROM "Message" m
            WHERE m."conversationId" = c."id"
              AND m."role" = 'user'
            ORDER BY m."createdAt" ASC
            LIMIT 1
          ),
          '\s+', ' ', 'g'
        )
      ),
      18
    ),
    ''
  ),
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM "Message" m
      JOIN "MessageAttachment" ma ON ma."messageId" = m."id"
      WHERE m."conversationId" = c."id"
        AND m."role" = 'user'
        AND (ma."kind" = 'image' OR ma."mimeType" LIKE 'image/%')
    ) THEN '图片对话'
    ELSE '新对话'
  END
)
WHERE c."title" ~ '(信息不足|无法概括|无法总结|无法确定|无法生成|无法命名|无法回答|不能概括|内容不足|首条消息内容不足|没有足够|未提供|抱歉|无题)'
   OR c."title" = '新对话';
