import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";

it.skipIf(!process.env.DATABASE_URL)("applies defaults on a clean schema and preserves existing model choices and billing", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = `qa_qwen_default_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    const root = join(process.cwd(), "prisma/migrations");
    const target = "20260908090000_default_chat_model_qwen";
    for (const migration of (await readdir(root)).filter((name) => name < target).sort()) {
      if (migration === "migration_lock.toml") continue;
      await client.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
    }
    await client.query('INSERT INTO "User" (id,email,"passwordHash","updatedAt") VALUES (\'owner\',\'qa@example.test\',\'test-only\',now())');
    await client.query('INSERT INTO "Conversation" (id,"userId",model,"updatedAt") VALUES (\'old-chat\',\'owner\',\'minimax-m3\',now())');
    await client.query('INSERT INTO "Project" (id,"userId",name,"defaultModel","updatedAt") VALUES (\'old-project\',\'owner\',\'old\',\'deepseek-v4-pro\',now())');
    await client.query('INSERT INTO "TokenUsage" (id,"userId",model,provider,"creditsConsumed") VALUES (\'bill\',\'owner\',\'deepseek-v4-pro\',\'deepseek\',123)');
    const snapshot = async () => {
      const rows = [];
      for (const table of ["Conversation", "Project", "TokenUsage"]) {
        rows.push((await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows);
      }
      return rows;
    };
    const before = await snapshot();
    await client.query(await readFile(join(root, target, "migration.sql"), "utf8"));
    expect(await snapshot()).toEqual(before);
    const chat = await client.query('INSERT INTO "Conversation" (id,"userId","updatedAt") VALUES (\'new-chat\',\'owner\',now()) RETURNING model');
    const project = await client.query('INSERT INTO "Project" (id,"userId",name,"updatedAt") VALUES (\'new-project\',\'owner\',\'new\',now()) RETURNING "defaultModel"');
    expect(chat.rows[0].model).toBe("qwen3.8-flash");
    expect(project.rows[0].defaultModel).toBe("qwen3.8-flash");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
