-- Expand only: preserve all existing users, identities, passwords and challenges.
-- PostgreSQL ordinary unique indexes allow multiple NULL values. Keep both the
-- Prisma email unique index and User_email_normalized_key safety protection.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "LoginAttempt" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "LoginAttempt" ADD COLUMN "identifier" TEXT, ADD COLUMN "identityType" TEXT;
UPDATE "LoginAttempt" SET "identifier" = lower(btrim("email")), "identityType" = 'email'
WHERE "email" IS NOT NULL;
CREATE INDEX "LoginAttempt_identifier_createdAt_idx" ON "LoginAttempt"("identifier", "createdAt");

-- Keep EmailChallenge_active_email_type_key for old releases. New SMS/bind rows
-- use distinct legacy types. Include old writers through COALESCE; no row rewrite.
CREATE UNIQUE INDEX "EmailChallenge_active_channel_target_purpose_key"
ON "EmailChallenge" (
  (COALESCE("channel", 'email')),
  (COALESCE("target", lower(btrim("email")))),
  (COALESCE("purpose", CASE "type" WHEN 'verify' THEN 'register' WHEN 'reset' THEN 'password_reset' ELSE "type" END))
) WHERE "consumedAt" IS NULL AND "verifiedAt" IS NULL;
