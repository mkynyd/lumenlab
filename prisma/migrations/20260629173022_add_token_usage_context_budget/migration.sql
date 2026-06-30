-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "subtype" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "creditsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cycleStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "planCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "planTier" TEXT NOT NULL DEFAULT 'premium';

-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputCacheHitTokens" INTEGER NOT NULL DEFAULT 0,
    "inputCacheMissTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenUsage_messageId_key" ON "TokenUsage"("messageId");

-- CreateIndex
CREATE INDEX "TokenUsage_userId_idx" ON "TokenUsage"("userId");

-- CreateIndex
CREATE INDEX "TokenUsage_userId_createdAt_idx" ON "TokenUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_conversationId_idx" ON "TokenUsage"("conversationId");

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
