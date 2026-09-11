import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Client } from "pg";
import { expect, it } from "vitest";

const root = join(process.cwd(), "prisma/migrations");
const target = "20260911100000_add_phone_authentication";
it("replays every historical migration, preserves old accounts and proofs, and permits multiple NULL email accounts", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const schema = `phone_replay_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    const names = (await readdir(root)).filter((name) => name !== "migration_lock.toml").sort();
    for (const name of names.filter((name) => name < target)) await client.query(await readFile(join(root, name, "migration.sql"), "utf8"));
    await client.query(`INSERT INTO "User" (id, email, "passwordHash", "emailVerifiedAt", "emailVerificationSource", "updatedAt") VALUES ('old', 'Old@Example.com', 'hash-must-not-change', now(), 'legacy', now())`);
    await client.query(`INSERT INTO "AuthIdentity" (id, "userId", type, provider, "providerAccountId", "verifiedAt", "verificationSource", "updatedAt") VALUES ('old-identity', 'old', 'email', 'local', 'old@example.com', now(), 'legacy', now())`);
    await client.query(`INSERT INTO "LoginAttempt" (id, email, ip, success) VALUES ('audit', 'Old@Example.com', '192.0.2.1', true)`);
    await client.query(`INSERT INTO "EmailChallenge" (id, type, email, "codeHash", "codeExpiresAt", "tokenHash", "tokenExpiresAt", "ticketHash", "ticketExpiresAt", "verifiedAt", "verifiedVia", "updatedAt") VALUES
      ('old-ticket', 'verify', 'new@example.com', 'code-hash', now()+interval '10 minutes', 'link-hash', now()+interval '30 minutes', 'ticket-hash', now()+interval '10 minutes', now(), 'code', now()),
      ('old-active', 'verify', 'active@example.com', 'active-code', now()+interval '10 minutes', 'active-link', now()+interval '30 minutes', null, null, null, null, now()),
      ('old-reset', 'reset', 'old@example.com', 'reset-code', now()+interval '10 minutes', 'reset-link', now()+interval '30 minutes', null, null, null, null, now())`);
    const before = [];
    for (const table of ["User", "AuthIdentity", "EmailChallenge"]) before.push((await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows);
    for (const name of names.filter((name) => name >= target)) await client.query(await readFile(join(root, name, "migration.sql"), "utf8"));
    const after = [];
    for (const table of ["User", "AuthIdentity", "EmailChallenge"]) after.push((await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows);
    expect(after).toEqual(before);
    expect((await client.query('SELECT email, identifier, "identityType" FROM "LoginAttempt"')).rows).toEqual([{ email: "Old@Example.com", identifier: "old@example.com", identityType: "email" }]);
    await client.query(`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ('phone-1', NULL, 'hash1', now()), ('phone-2', NULL, 'hash2', now())`);
    expect((await client.query('SELECT count(*)::int AS n FROM "User" WHERE email IS NULL')).rows[0].n).toBe(2);
    await client.query("SAVEPOINT normalized_unique");
    await expect(client.query(`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ('bad', ' old@example.com ', 'never', now())`)).rejects.toThrow(/User_email_normalized_key/);
    await client.query("ROLLBACK TO SAVEPOINT normalized_unique");
    const indexes = (await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'AuthIdentity'`, [schema])).rows.map((row) => row.indexname);
    expect(indexes).toContain("AuthIdentity_provider_providerAccountId_key");
    expect(indexes).toContain("AuthIdentity_userId_type_key");
    // Old writers still insert nullable generic columns after Phase 2.
    await client.query(`INSERT INTO "EmailChallenge" (id, type, email, "codeHash", "codeExpiresAt", "updatedAt") VALUES ('old-writer', 'verify', 'writer@example.com', 'hash', now()+interval '5 minutes', now())`);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
