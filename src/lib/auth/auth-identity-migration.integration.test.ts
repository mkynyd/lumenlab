/**
 * 认证身份 Expand Migration 演练（真实 PostgreSQL，scratch schema + 回滚）。
 *
 * 在临时 schema 里重放历史 migration 到新增迁移之前，构造“migration 已应用、
 * 旧 Release 仍可能写入”的历史数据，再应用目标 migration，验证：
 *   1. 历史 User 全部回填唯一的 email Identity，providerAccountId 已规范化；
 *   2. legacy User 认证列与业务数据未被改动；
 *   3. 已有 EmailChallenge 的 legacy 语义被无损补全，Ticket/Token 未被清空；
 *   4. 规范化冲突（两个账户映射到同一 normalized email）安全失败。
 * 全程在一个事务里，结束后 ROLLBACK，不污染开发库。
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";

const MIGRATIONS_ROOT = join(process.cwd(), "prisma/migrations");
const TARGET = "20260910103640_add_auth_identity_and_generalize_challenges";

async function migrationsBefore(target: string): Promise<string[]> {
  return (await readdir(MIGRATIONS_ROOT))
    .filter((name) => name !== "migration_lock.toml" && name < target)
    .sort();
}

async function readMigration(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_ROOT, name, "migration.sql"), "utf8");
}

it.skipIf(!process.env.DATABASE_URL)(
  "backfills one normalized email identity per historical user and preserves legacy columns",
  async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const schema = `qa_auth_identity_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}", public`);
      for (const migration of await migrationsBefore(TARGET)) {
        await client.query(await readMigration(migration));
      }

      // 历史 User：混合“已验证 legacy”与“未验证”，并混入大小写/空格差异
      await client.query(`
        INSERT INTO "User" (id, email, "passwordHash", "emailVerifiedAt", "emailVerificationSource", "updatedAt") VALUES
          ('u1', 'Verified@Example.com',    'hash-1', '2026-01-01T00:00:00Z', 'legacy', now()),
          ('u2', '  padded@example.com  ',  'hash-2', '2026-02-02T00:00:00Z', 'code',   now()),
          ('u3', 'unverified@example.com',  'hash-3', NULL,                   'none',   now())
      `);
      await client.query(`
        INSERT INTO "Project" (id, "userId", name, "updatedAt")
        VALUES ('p1', 'u1', 'Historical project', now())
      `);
      // 历史挑战：注册验证（active + 已签发未消费票票据）与密码重设（未消费 token）
      await client.query(`
        INSERT INTO "EmailChallenge"
          (id, type, email, "codeHash", "codeExpiresAt", "tokenHash", "tokenExpiresAt", "ticketHash", "ticketExpiresAt", "verifiedAt", "verifiedVia", "updatedAt")
        VALUES
          ('c-verify', 'verify', 'Verified@Example.com', 'code-hash-1', now() + interval '10 min',
           'token-hash-1', now() + interval '50 min', NULL, NULL, NULL, NULL, now()),
          ('c-reset',  'reset',  'padded@example.com',   'code-hash-2', now() + interval '10 min',
           'token-hash-2', now() + interval '50 min', NULL, NULL, NULL, NULL, now()),
          ('c-ticket', 'verify', 'unverified@example.com', 'code-hash-3', now() + interval '10 min',
           'token-hash-3', now() + interval '50 min', 'ticket-hash-3', now() + interval '5 min',
           now() - interval '1 min', 'code', now())
      `);

      const beforeUsers = (
        await client.query('SELECT * FROM "User" ORDER BY id')
      ).rows;
      const beforeProjects = (
        await client.query('SELECT * FROM "Project" ORDER BY id')
      ).rows;
      const beforeChallenges = (
        await client.query(
          'SELECT id, type, email, "ticketHash", "tokenHash", "verifiedAt" FROM "EmailChallenge" ORDER BY id'
        )
      ).rows;

      await client.query(await readMigration(TARGET));

      // 1. legacy User 认证列与业务数据完全未变
      expect((await client.query('SELECT * FROM "User" ORDER BY id')).rows).toEqual(
        beforeUsers
      );
      expect(
        (await client.query('SELECT * FROM "Project" ORDER BY id')).rows
      ).toEqual(beforeProjects);

      // 2. 每个历史 User 恰好一个 email identity，providerAccountId 已规范化
      //    注意：emailVerifiedAt 是 TIMESTAMP(3)（无时区），pg 客户端按服务器
      //    时区解析，因此用 epoch 比较而不是字面 UTC 字符串。
      const backfilled = await client.query(`
        SELECT ai."userId", ai.type, ai.provider, ai."providerAccountId",
               ai."verifiedAt", ai."verificationSource", u.email AS legacy_email
          FROM "AuthIdentity" ai JOIN "User" u ON u.id = ai."userId"
         ORDER BY ai."userId"
      `);
      expect(backfilled.rowCount).toBe(3);
      expect(backfilled.rows).toEqual([
        {
          userId: "u1",
          type: "email",
          provider: "local",
          providerAccountId: "verified@example.com",
          verifiedAt: expect.any(Date),
          verificationSource: "legacy",
          legacy_email: "Verified@Example.com",
        },
        {
          userId: "u2",
          type: "email",
          provider: "local",
          providerAccountId: "padded@example.com",
          verifiedAt: expect.any(Date),
          verificationSource: "code",
          legacy_email: "  padded@example.com  ",
        },
        {
          userId: "u3",
          type: "email",
          provider: "local",
          providerAccountId: "unverified@example.com",
          verifiedAt: null,
          verificationSource: "none",
          legacy_email: "unverified@example.com",
        },
      ]);

      // verifiedAt 必须是 legacy User.emailVerifiedAt 的原值（按 epoch 比较）
      const legacyVerifiedAt = await client.query(
        'SELECT "emailVerifiedAt" FROM "User" WHERE id = $1',
        ["u1"]
      );
      expect(backfilled.rows[0].verifiedAt.getTime()).toBe(
        (legacyVerifiedAt.rows[0].emailVerifiedAt as Date).getTime()
      );
      const legacyPaddedVerifiedAt = await client.query(
        'SELECT "emailVerifiedAt" FROM "User" WHERE id = $1',
        ["u2"]
      );
      expect(backfilled.rows[1].verifiedAt.getTime()).toBe(
        (legacyPaddedVerifiedAt.rows[0].emailVerifiedAt as Date).getTime()
      );

      // 每个账户每种 identity type 至多一条
      const counts = await client.query(`
        SELECT "userId", count(*)::int AS n FROM "AuthIdentity"
         GROUP BY "userId" HAVING count(*) > 1
      `);
      expect(counts.rowCount).toBe(0);

      // 3. 挑战通用列被无损补全，Ticket/Token 未被清空
      const challenges = await client.query(
        'SELECT id, channel, target, purpose, "ticketHash", "tokenHash" FROM "EmailChallenge" ORDER BY id'
      );
      expect(challenges.rows).toEqual([
        {
          id: "c-reset",
          channel: "email",
          target: "padded@example.com",
          purpose: "password_reset",
          ticketHash: null,
          tokenHash: "token-hash-2",
        },
        {
          id: "c-ticket",
          channel: "email",
          target: "unverified@example.com",
          purpose: "register",
          ticketHash: "ticket-hash-3",
          tokenHash: "token-hash-3",
        },
        {
          id: "c-verify",
          channel: "email",
          target: "verified@example.com",
          purpose: "register",
          ticketHash: null,
          tokenHash: "token-hash-1",
        },
      ]);
      const preserved = await client.query(
        'SELECT id, type, email, "ticketHash", "tokenHash", "verifiedAt" FROM "EmailChallenge" ORDER BY id'
      );
      expect(preserved.rows).toEqual(beforeChallenges);

      // 4. 旧 Release 仍可写入：legacy 列无需通用列即可插入
      //    （新增列全部 nullable，旧版本 INSERT 不带它们也能成功）
      await client.query(`
        INSERT INTO "EmailChallenge" (id, type, email, "codeHash", "codeExpiresAt", "tokenHash", "tokenExpiresAt", "updatedAt")
        VALUES ('c-old-release', 'verify', 'newcomer@example.com', 'code-hash-4',
                now() + interval '10 min', 'token-hash-4', now() + interval '50 min', now())
      `);
      const oldReleaseRow = await client.query(
        `SELECT channel, target, purpose FROM "EmailChallenge" WHERE id = 'c-old-release'`
      );
      expect(oldReleaseRow.rows[0]).toEqual({
        channel: null,
        target: null,
        purpose: null,
      });

      // 5. 新增的大小写不敏感唯一索引生效（用 SAVEPOINT 隔断失败语句，
      //    否则后续语句会因事务已中止而全部报错）
      await client.query("SAVEPOINT dup_email");
      await expect(
        client.query(
          `INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ('u4', 'VERIFIED@example.com', 'hash-4', now())`
        )
      ).rejects.toThrow(/User_email_normalized_key/);
      await client.query("ROLLBACK TO SAVEPOINT dup_email");
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  }
);

it.skipIf(!process.env.DATABASE_URL)(
  "aborts safely when two historical users collapse to the same normalized email",
  async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const schema = `qa_auth_conflict_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}", public`);
      for (const migration of await migrationsBefore(TARGET)) {
        await client.query(await readMigration(migration));
      }

      // 绕过大小写敏感的唯一约束，构造两个只差大小写的账户
      // （Prisma 生成的是唯一索引 User_email_key，不是表约束）
      await client.query('DROP INDEX "User_email_key"');
      await client.query(`
        INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES
          ('dup-a', 'Same@Example.com', 'hash-a', now()),
          ('dup-b', 'same@example.com', 'hash-b', now())
      `);

      // SAVEPOINT：迁移在事务内中止后回滚到此处，才能继续查询断言状态。
      // （`prisma migrate deploy` 在真实环境同样把整个 migration 当作一个失败单元）
      await client.query("SAVEPOINT before_migration");
      let error: unknown = null;
      try {
        await client.query(await readMigration(TARGET));
      } catch (caught) {
        error = caught;
      }
      await client.query("ROLLBACK TO SAVEPOINT before_migration");

      expect(error).not.toBeNull();
      // 迁移主动中止并点名冲突账户，不静默覆盖 / 合并 / 删除
      expect((error as Error).message).toMatch(/collapse to the same normalized email/);
      expect((error as Error).message).toMatch(/dup-a/);
      expect((error as Error).message).toMatch(/dup-b/);

      // 迁移在冲突检查处中止，整个 migration 被回滚（Prisma 把每个 migration
      // 当作一个失败单元）：scratch schema 里不会留下 AuthIdentity 半成品，
      // 也不会留下任何指向不存在 / 被合并账户的 identity。
      // 注意必须限定 schema——search_path 此时可能已回落到 public。
      const table = await client.query(
        `SELECT to_regclass('"${schema}"."AuthIdentity"') AS name`
      );
      expect(table.rows[0].name).toBeNull();
      // 两个历史账户都还在，未被静默合并或删除
      const users = await client.query(
        `SELECT count(*)::int AS n FROM "${schema}"."User"`
      );
      expect(users.rows[0].n).toBe(2);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  }
);
