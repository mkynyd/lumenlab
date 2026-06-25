/**
 * Seed or update a user's custom provider API key for self-hosted deployments.
 *
 * Usage:
 *   USER_API_KEYS_ENABLED=1 npx tsx scripts/setup-api-key.ts \
 *     --email=user@example.com \
 *     --provider=deepseek \
 *     --key=sk-xxx
 *
 * Requirements:
 *   - DATABASE_URL and ENCRYPTION_KEY must be set in the environment.
 *   - USER_API_KEYS_ENABLED should be truthy (the script will warn otherwise).
 */

import { prisma } from "@/lib/db";
import { encrypt, maskApiKey } from "@/lib/crypto";
import { USER_API_KEYS_ENABLED } from "@/lib/config";

const PROVIDERS = ["deepseek", "minimax", "mineru", "bailian"] as const;
type Provider = (typeof PROVIDERS)[number];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index !== -1 ? args[index + 1] : undefined;
  };

  const email = get("--email");
  const provider = get("--provider");
  const key = get("--key");

  if (!email || !provider || !key) {
    console.error("用法: npx tsx scripts/setup-api-key.ts --email=<邮箱> --provider=<deepseek|minimax|mineru|bailian> --key=<API Key>");
    process.exit(1);
  }

  if (!PROVIDERS.includes(provider as Provider)) {
    console.error(`不支持的 provider: ${provider}。可选: ${PROVIDERS.join(", ")}`);
    process.exit(1);
  }

  return { email, provider: provider as Provider, key };
}

async function main() {
  if (!USER_API_KEYS_ENABLED) {
    console.warn("警告: USER_API_KEYS_ENABLED 未启用。请设置环境变量 USER_API_KEYS_ENABLED=1 或在 src/lib/config.ts 中开启。");
  }

  const { email, provider, key } = parseArgs();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    console.error(`未找到用户: ${email}`);
    process.exit(1);
  }

  const encryptedKey = encrypt(key);
  const keyPrefix = maskApiKey(key);

  await prisma.apiKey.upsert({
    where: { userId_provider: { userId: user.id, provider } },
    create: {
      userId: user.id,
      provider,
      encryptedKey,
      keyPrefix,
    },
    update: {
      encryptedKey,
      keyPrefix,
    },
  });

  console.log(`已为 ${email} 设置 ${provider} API Key: ${keyPrefix}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
