-- CreateEnum
CREATE TYPE "StudyPackOutlineStatus" AS ENUM ('draft', 'confirmed');

-- CreateEnum
CREATE TYPE "StudyPackSectionStatus" AS ENUM ('draft', 'queued', 'generating', 'ready', 'failed', 'stale');

-- CreateTable
CREATE TABLE "StudyPack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outline" JSONB NOT NULL,
    "outlineStatus" "StudyPackOutlineStatus" NOT NULL DEFAULT 'draft',
    "sourceFingerprint" TEXT NOT NULL,
    "publishedArtifactId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPackSection" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "StudyPackSectionStatus" NOT NULL DEFAULT 'draft',
    "content" TEXT,
    "userEditedContent" TEXT,
    "userEditedAt" TIMESTAMP(3),
    "sourceFingerprint" TEXT,
    "generationMetadata" JSONB,
    "failureReason" TEXT,
    "agentExecutionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPackSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyPack_goalId_createdAt_idx" ON "StudyPack"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "StudyPack_userId_outlineStatus_idx" ON "StudyPack"("userId", "outlineStatus");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPack_userId_idempotencyKey_key" ON "StudyPack"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPackSection_agentExecutionId_key" ON "StudyPackSection"("agentExecutionId");

-- CreateIndex
CREATE INDEX "StudyPackSection_packId_status_idx" ON "StudyPackSection"("packId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPackSection_packId_orderIndex_key" ON "StudyPackSection"("packId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPackSection_packId_key_key" ON "StudyPackSection"("packId", "key");

-- AddForeignKey
ALTER TABLE "StudyPack" ADD CONSTRAINT "StudyPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPack" ADD CONSTRAINT "StudyPack_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPack" ADD CONSTRAINT "StudyPack_publishedArtifactId_fkey" FOREIGN KEY ("publishedArtifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPackSection" ADD CONSTRAINT "StudyPackSection_packId_fkey" FOREIGN KEY ("packId") REFERENCES "StudyPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

