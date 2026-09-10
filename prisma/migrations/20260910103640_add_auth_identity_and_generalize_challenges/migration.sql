-- ============================================================================
-- Auth 底层架构第一阶段迁移：AuthIdentity（Expand）+ VerificationChallenge 通用化
--
-- 背景：生产部署模型是“先应用 migration，旧 Release 仍可能短暂运行，随后才原子
-- 切换新 Release”。因此本迁移严格采用 expand-and-contract：
--   * 不删除、不改名、不改为 nullable 任何旧认证列
--     （User.email / passwordHash / emailVerifiedAt / emailVerificationSource）
--   * 不改名 EmailChallenge 物理表（旧 Release 仍按旧表名读写）
--   * 新增的 AuthIdentity 表与 EmailChallenge 通用列都是旧 Release 可忽略的
--
-- 事务语义：文件内不写 BEGIN/COMMIT。`prisma migrate deploy` 默认把每个
-- migration 包在一个事务里执行，显式 COMMIT 会提前提交外层事务并让
-- search_path / 演练事务失效（本地 migration 演练已复现）。因此这里依赖
-- Prisma 的事务边界来保证“全部成功或全部回滚”。
-- ============================================================================

-- 回填期间阻塞 User 写入（允许并发读，不影响旧 Release 的登录/读取）。
-- 目的：保证“回填完成 → normalized 唯一索引建立”之间不会插入新的 User 行，
-- 否则可能出现回填后新增的大小写变体邮箱绕过唯一索引。
LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE;

-- ----------------------------------------------------------------------------
-- 1. AuthIdentity：认证身份表（“用户能用什么标识找到这个账户”）
--    密码仍留在 User.passwordHash（账户级凭证，不属于某个 identity）。
-- ----------------------------------------------------------------------------
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verificationSource" TEXT NOT NULL DEFAULT 'none',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- 同一个外部身份只能属于一个 User；每个 User 每种 identity type 至多一个。
CREATE UNIQUE INDEX "AuthIdentity_provider_providerAccountId_key"
  ON "AuthIdentity"("provider", "providerAccountId");
CREATE UNIQUE INDEX "AuthIdentity_userId_type_key"
  ON "AuthIdentity"("userId", "type");
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 2. 邮箱规范化冲突预检
--
--    User.email 上的唯一约束是大小写敏感的，理论上可能同时存在
--    "A@x.com" 与 "a@x.com" 两个账户。它们规范化后会映射到同一个
--    AuthIdentity.providerAccountId，属于必须人工处理的账户冲突。
--    这里主动检查并中止迁移：禁止静默覆盖、合并或删除账户。
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  conflicts TEXT;
BEGIN
  SELECT string_agg(
           format('normalized=%s -> User.id=%s', normalized, ids),
           E'\n'
         )
    INTO conflicts
    FROM (
      SELECT lower(btrim("email")) AS normalized,
             string_agg("id", ', ' ORDER BY "id") AS ids
        FROM "User"
       GROUP BY lower(btrim("email"))
      HAVING count(*) > 1
    ) AS duplicated;

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION
      E'AuthIdentity backfill aborted: % distinct User rows collapse to the same normalized email.\n%s\nResolve these accounts manually before re-running the migration.',
      (SELECT count(*) FROM (
         SELECT 1 FROM "User" GROUP BY lower(btrim("email")) HAVING count(*) > 1
       ) AS c),
      conflicts;
  END IF;
END $$;

-- 供应用层做大小写不敏感 legacy 查找（Expand 阶段 fallback）。
-- 与回填使用完全相同的表达式，保证两者判定一致；建立唯一索引后，
-- 规范化后的邮箱在数据库层面也不可能落到两个账户。
CREATE UNIQUE INDEX "User_email_normalized_key" ON "User"(lower(btrim("email")));

-- ----------------------------------------------------------------------------
-- 3. 历史 User 回填 email Identity
--
--    userId            = User.id
--    type              = 'email'
--    provider          = 'local'
--    providerAccountId = normalized User.email
--    verifiedAt        = User.emailVerifiedAt
--    verificationSource= User.emailVerificationSource
--
--    不重新 hash 密码：密码仍保存在 User.passwordHash。
--    历史 User 一次性全部回填，因此新版本解析时不需要“无 identity 就拒绝登录”，
--    而 fallback 只用于覆盖 migration 与 Release 切换之间由旧版本新建的用户。
-- ----------------------------------------------------------------------------
INSERT INTO "AuthIdentity" (
  "id", "userId", "type", "provider", "providerAccountId",
  "verifiedAt", "verificationSource", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  u."id",
  'email',
  'local',
  lower(btrim(u."email")),
  u."emailVerifiedAt",
  COALESCE(u."emailVerificationSource", 'none'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u;

-- 回填校验：每个 User 必须恰好有一个 email identity，且 providerAccountId 已规范化。
-- 任一条件不成立都中止整个迁移，避免带着不完整的 identity 数据切换 Release。
DO $$
DECLARE
  missing INTEGER;
  not_normalized INTEGER;
BEGIN
  SELECT count(*) INTO missing
    FROM "User" u
   WHERE NOT EXISTS (
     SELECT 1 FROM "AuthIdentity" ai
      WHERE ai."userId" = u."id" AND ai."type" = 'email' AND ai."provider" = 'local'
   );
  IF missing > 0 THEN
    RAISE EXCEPTION 'AuthIdentity backfill incomplete: % User rows have no email identity', missing;
  END IF;

  SELECT count(*) INTO not_normalized
    FROM "AuthIdentity" ai
    JOIN "User" u ON u."id" = ai."userId"
   WHERE ai."type" = 'email'
     AND ai."provider" = 'local'
     AND ai."providerAccountId" <> lower(btrim(u."email"));
  IF not_normalized > 0 THEN
    RAISE EXCEPTION 'AuthIdentity backfill produced % non-normalized providerAccountId values', not_normalized;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. VerificationChallenge 通用列（expand：nullable，不做 NOT NULL）
--
--    目标模型可表达 channel = email | sms、target = 邮箱或手机号、
--    purpose = register | bind_identity | password_reset | ...
--    本阶段只有 email channel：新版本写入时同时写通用列与 legacy
--    type/email 列（双写），旧 Release 只写 legacy 列也能被新版本无损推导。
-- ----------------------------------------------------------------------------
ALTER TABLE "EmailChallenge"
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "target" TEXT,
  ADD COLUMN "purpose" TEXT;

CREATE INDEX "EmailChallenge_channel_target_purpose_idx"
  ON "EmailChallenge"("channel", "target", "purpose");

-- 现有挑战数据回填。type 到 purpose 的映射依据仓库真实使用的 type 值：
--   'verify' → 'register'（注册邮箱验证）
--   'reset'  → 'password_reset'（密码重设）
-- 未消费 Ticket / 密码重置 Token / 活跃 Challenge 全部保留，不做任何清空。
UPDATE "EmailChallenge"
   SET "channel" = 'email',
       "target"  = lower(btrim("email")),
       "purpose" = CASE "type"
                     WHEN 'verify' THEN 'register'
                     WHEN 'reset'  THEN 'password_reset'
                     ELSE NULL
                   END,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "channel" IS NULL
    OR "target" IS NULL
    OR "purpose" IS NULL;
