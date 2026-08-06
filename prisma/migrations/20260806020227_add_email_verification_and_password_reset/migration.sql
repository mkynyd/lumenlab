-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationSource" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailChallenge" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "codeHash" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "codeVerifiedAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "tokenConsumedAt" TIMESTAMP(3),
    "verifiedVia" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "ticketHash" TEXT,
    "ticketExpiresAt" TIMESTAMP(3),
    "ticketConsumedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "challengeId" TEXT,
    "bulkId" TEXT,
    "smtpMessageId" TEXT,
    "event" TEXT NOT NULL DEFAULT 'sent',
    "bounceType" TEXT,
    "reason" TEXT,
    "templateId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLogEvent" (
    "id" TEXT NOT NULL,
    "emailLogId" TEXT,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLogEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailChallenge_tokenHash_key" ON "EmailChallenge"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailChallenge_ticketHash_key" ON "EmailChallenge"("ticketHash");

-- CreateIndex
CREATE INDEX "EmailChallenge_email_type_idx" ON "EmailChallenge"("email", "type");

-- CreateIndex
CREATE INDEX "EmailChallenge_consumedAt_idx" ON "EmailChallenge"("consumedAt");

-- CreateIndex
CREATE INDEX "EmailLog_bulkId_idx" ON "EmailLog"("bulkId");

-- CreateIndex
CREATE INDEX "EmailLog_email_createdAt_idx" ON "EmailLog"("email", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_event_idx" ON "EmailLog"("event");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLogEvent_payloadHash_key" ON "EmailLogEvent"("payloadHash");

-- CreateIndex
CREATE INDEX "EmailLogEvent_emailLogId_idx" ON "EmailLogEvent"("emailLogId");

-- AddForeignKey
ALTER TABLE "EmailChallenge" ADD CONSTRAINT "EmailChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLogEvent" ADD CONSTRAINT "EmailLogEvent_emailLogId_fkey" FOREIGN KEY ("emailLogId") REFERENCES "EmailLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 部分唯一索引：同 email+type 至多一个活跃挑战（Prisma schema 无法声明，手工追加）
CREATE UNIQUE INDEX "EmailChallenge_active_email_type_key"
  ON "EmailChallenge" ("email", "type")
  WHERE "consumedAt" IS NULL AND "verifiedAt" IS NULL;

-- 老用户兼容：不强制重新验证邮箱，标记为 legacy 已验证
UPDATE "User"
   SET "emailVerifiedAt" = "createdAt",
       "emailVerificationSource" = 'legacy'
 WHERE "emailVerifiedAt" IS NULL;
