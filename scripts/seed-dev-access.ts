/**
 * Seed local development access after database resets.
 *
 * Usage:
 *   USER_API_KEYS_ENABLED=1 npx tsx scripts/seed-dev-access.ts
 *
 * Required env:
 *   DEV_USER_PASSWORD (no default; must be set explicitly)
 *
 * Optional env:
 *   DEV_USER_EMAIL, DEV_USER_NAME
 *   DEV_DEEPSEEK_API_KEY, DEV_MINIMAX_API_KEY, DEV_MINERU_API_KEY, DEV_BAILIAN_API_KEY
 *   or DEEPSEEK_API_KEY, MINIMAX_API_KEY, MINERU_API_KEY, BAILIAN_API_KEY
 */

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { encrypt, maskApiKey } from "@/lib/crypto";
import { USER_API_KEYS_ENABLED } from "@/lib/config";
import type { ProviderName } from "@/lib/provider-access";

const PROVIDERS: ProviderName[] = ["deepseek", "minimax", "mineru", "bailian"];

function envName(provider: ProviderName) {
  return provider.toUpperCase();
}

function getProviderKey(provider: ProviderName) {
  const prefix = envName(provider);
  return (
    process.env[`DEV_${prefix}_API_KEY`] ||
    process.env[`${prefix}_API_KEY`] ||
    ""
  );
}

async function main() {
  const email = process.env.DEV_USER_EMAIL || "dev@example.com";
  const password = process.env.DEV_USER_PASSWORD;
  if (!password) {
    console.error(
      "DEV_USER_PASSWORD is not set. Refusing to seed without an explicit password."
    );
    process.exit(1);
  }
  const name = process.env.DEV_USER_NAME || "Dev User";
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      name,
      accessStatus: "active",
    },
    update: {
      passwordHash,
      name,
      accessStatus: "active",
    },
    select: { id: true, email: true, accessStatus: true },
  });

  console.log(`Dev user ready: ${user.email} (${user.accessStatus})`);

  if (!USER_API_KEYS_ENABLED) {
    console.warn("USER_API_KEYS_ENABLED is not enabled; skipped user API keys.");
    return;
  }

  for (const provider of PROVIDERS) {
    const apiKey = getProviderKey(provider);
    if (!apiKey) {
      console.warn(`Skipped ${provider}: no API key env provided.`);
      continue;
    }
    const keyPrefix = maskApiKey(apiKey);
    await prisma.apiKey.upsert({
      where: { userId_provider: { userId: user.id, provider } },
      create: {
        userId: user.id,
        provider,
        encryptedKey: encrypt(apiKey),
        keyPrefix,
      },
      update: {
        encryptedKey: encrypt(apiKey),
        keyPrefix,
      },
    });
    console.log(`Stored ${provider} API key: ${keyPrefix}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
