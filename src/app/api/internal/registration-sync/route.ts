import { createHash, createPrivateKey } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { digestRegistrationCode } from "@/lib/registration-code";
import {
  decryptSyncEnvelope,
  verifySyncSignature,
} from "@/lib/registration-sync-crypto";
import {
  isSyncTimestampFresh,
  registrationSnapshotSchema,
  syncEnvelopeSchema,
} from "@/lib/registration-sync";

export const runtime = "nodejs";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function POST(request: Request) {
  const timestamp = request.headers.get("x-sync-timestamp") || "";
  const nonce = request.headers.get("x-sync-nonce") || "";
  const signature = request.headers.get("x-sync-signature") || "";
  const body = await request.text();

  let secret: string;
  try {
    secret = requiredEnvironment("REGISTRATION_SYNC_SECRET");
  } catch {
    return NextResponse.json(
      { error: "同步服务尚未配置" },
      { status: 503 }
    );
  }

  if (
    !isSyncTimestampFresh(timestamp) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) ||
    !verifySyncSignature({
      body,
      timestamp,
      nonce,
      signature,
      secret,
    })
  ) {
    return NextResponse.json({ error: "同步请求认证失败" }, { status: 401 });
  }

  let snapshot;
  try {
    const envelope = syncEnvelopeSchema.parse(JSON.parse(body));
    const privateKey = createPrivateKey({
      key: Buffer.from(
        requiredEnvironment("REGISTRATION_SYNC_PRIVATE_KEY_BASE64"),
        "base64"
      ),
      format: "pem",
    });
    const plaintext = decryptSyncEnvelope(envelope, privateKey);
    snapshot = registrationSnapshotSchema.parse(JSON.parse(plaintext));
  } catch {
    return NextResponse.json({ error: "同步载荷无效" }, { status: 400 });
  }

  const payloadDigest = createHash("sha256").update(body).digest("hex");
  const pepper = process.env.REGISTRATION_CODE_PEPPER;
  if (!pepper) {
    return NextResponse.json(
      { error: "注册码服务尚未配置" },
      { status: 503 }
    );
  }

  try {
    const result = await prisma.$transaction(
      async (transaction) => {
        await transaction.registrationSyncNonce.deleteMany({
          where: { expiresAt: { lte: new Date() } },
        });
        await transaction.registrationSyncNonce.create({
          data: {
            nonce,
            expiresAt: new Date(Number(timestamp) + 5 * 60_000),
          },
        });

        const existing = await transaction.registrationPublication.findUnique({
          where: { externalId: snapshot.publicationId },
        });
        if (existing) {
          if (existing.payloadDigest !== payloadDigest) {
            throw new Error("publication_conflict");
          }
          return {
            version: existing.version,
            idempotent: true,
          };
        }

        const latest = await transaction.registrationPublication.findFirst({
          orderBy: { version: "desc" },
          select: { version: true },
        });
        if (latest && snapshot.version <= latest.version) {
          throw new Error("stale_version");
        }

        const profileIds = new Map<string, string>();
        for (const profile of snapshot.credentialProfiles) {
          const saved = await transaction.credentialProfile.upsert({
            where: { externalId: profile.id },
            create: {
              externalId: profile.id,
              name: profile.name,
              status: profile.status,
              version: profile.version,
            },
            update: {
              name: profile.name,
              status: profile.status,
              version: profile.version,
            },
            select: { id: true },
          });
          profileIds.set(profile.id, saved.id);

          for (const credential of profile.credentials) {
            await transaction.providerCredential.upsert({
              where: { externalId: credential.id },
              create: {
                externalId: credential.id,
                credentialProfileId: saved.id,
                provider: credential.provider,
                encryptedKey: encrypt(credential.key),
                keyPrefix: credential.keyPrefix,
                status: credential.status,
                validatedAt: new Date(credential.validatedAt),
              },
              update: {
                credentialProfileId: saved.id,
                provider: credential.provider,
                encryptedKey: encrypt(credential.key),
                keyPrefix: credential.keyPrefix,
                status: credential.status,
                validatedAt: new Date(credential.validatedAt),
              },
            });
          }
        }

        for (const code of snapshot.registrationCodes) {
          const credentialProfileId = profileIds.get(
            code.credentialProfileId
          );
          if (!credentialProfileId) throw new Error("missing_profile");

          const current = await transaction.registrationCode.findUnique({
            where: { externalId: code.id },
            select: { redemptionCount: true },
          });
          if (
            current &&
            code.maxRedemptions < current.redemptionCount
          ) {
            throw new Error("redemption_limit_below_usage");
          }

          const savedCode = await transaction.registrationCode.upsert({
            where: { externalId: code.id },
            create: {
              externalId: code.id,
              credentialProfileId,
              label: code.label,
              codeDigest: digestRegistrationCode(code.code, pepper),
              codeHint: code.codeHint,
              status: code.status,
              maxRedemptions: code.maxRedemptions,
              expiresAt: code.expiresAt
                ? new Date(code.expiresAt)
                : null,
              publishedVersion: snapshot.version,
            },
            update: {
              credentialProfileId,
              label: code.label,
              codeDigest: digestRegistrationCode(code.code, pepper),
              codeHint: code.codeHint,
              status: code.status,
              maxRedemptions: code.maxRedemptions,
              expiresAt: code.expiresAt
                ? new Date(code.expiresAt)
                : null,
              publishedVersion: snapshot.version,
            },
            select: { id: true },
          });
          if (code.revokeRedeemedUsers) {
            await transaction.user.updateMany({
              where: {
                redemption: { is: { codeId: savedCode.id } },
              },
              data: { accessStatus: "revoked" },
            });
          }
        }

        await transaction.registrationPublication.create({
          data: {
            externalId: snapshot.publicationId,
            version: snapshot.version,
            payloadDigest,
            sourceIssuedAt: new Date(snapshot.issuedAt),
          },
        });

        return { version: snapshot.version, idempotent: false };
      },
      { isolationLevel: "Serializable", timeout: 30_000 }
    );

    const usage = await prisma.registrationCode.findMany({
      where: {
        externalId: {
          in: snapshot.registrationCodes.map((code) => code.id),
        },
      },
      select: {
        externalId: true,
        redemptionCount: true,
        maxRedemptions: true,
      },
    });

    return NextResponse.json({ success: true, ...result, usage });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "同步请求已处理" }, { status: 409 });
    }
    const message =
      error instanceof Error ? error.message : "sync_failed";
    const status =
      message === "stale_version" ||
      message === "publication_conflict" ||
      message === "redemption_limit_below_usage"
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
