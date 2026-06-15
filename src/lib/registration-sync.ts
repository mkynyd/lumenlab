import { z } from "zod";

export const syncEnvelopeSchema = z.object({
  encryptedKey: z.string().min(1).max(4096),
  iv: z.string().min(1).max(128),
  authTag: z.string().min(1).max(128),
  ciphertext: z.string().min(1).max(5_000_000),
});

const providerCredentialSchema = z.object({
  id: z.string().min(1).max(128),
  provider: z.enum(["deepseek", "minimax"]),
  key: z.string().min(1).max(512),
  keyPrefix: z.string().min(1).max(64),
  status: z.enum(["active", "disabled"]),
  validatedAt: z.iso.datetime(),
});

const credentialProfileSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(120),
    status: z.enum(["active", "disabled"]),
    version: z.number().int().positive(),
    credentials: z.array(providerCredentialSchema).min(1).max(2),
  })
  .superRefine((profile, context) => {
    const providers = new Set(
      profile.credentials.map((credential) => credential.provider)
    );
    if (providers.size !== profile.credentials.length) {
      context.addIssue({
        code: "custom",
        message: "密钥组不能包含重复供应商",
        path: ["credentials"],
      });
    }
    if (
      !profile.credentials.some(
        (credential) =>
          credential.provider === "deepseek" &&
          credential.status === "active"
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "密钥组必须包含已启用的 DeepSeek Key",
        path: ["credentials"],
      });
    }
  });

const registrationCodeSnapshotSchema = z.object({
  id: z.string().min(1).max(128),
  credentialProfileId: z.string().min(1).max(128),
  label: z.string().min(1).max(120),
  code: z.string().min(8).max(128),
  codeHint: z.string().min(1).max(64),
  status: z.enum(["active", "disabled"]),
  maxRedemptions: z.number().int().positive(),
  expiresAt: z.iso.datetime().nullable(),
  revokeRedeemedUsers: z.boolean(),
});

export const registrationSnapshotSchema = z
  .object({
    publicationId: z.string().min(1).max(128),
    version: z.number().int().positive(),
    issuedAt: z.iso.datetime(),
    credentialProfiles: z.array(credentialProfileSchema).max(100),
    registrationCodes: z.array(registrationCodeSnapshotSchema).max(10_000),
  })
  .superRefine((snapshot, context) => {
    const profileIds = new Set(
      snapshot.credentialProfiles.map((profile) => profile.id)
    );
    for (const [index, code] of snapshot.registrationCodes.entries()) {
      if (!profileIds.has(code.credentialProfileId)) {
        context.addIssue({
          code: "custom",
          message: "注册码引用了不存在的密钥组",
          path: ["registrationCodes", index, "credentialProfileId"],
        });
      }
    }
  });

export type RegistrationSnapshot = z.infer<
  typeof registrationSnapshotSchema
>;

export function isSyncTimestampFresh(
  timestamp: string,
  now = Date.now(),
  maxSkewMs = 5 * 60_000
): boolean {
  const value = Number(timestamp);
  return Number.isFinite(value) && Math.abs(now - value) <= maxSkewMs;
}
