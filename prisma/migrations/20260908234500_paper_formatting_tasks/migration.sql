-- AlterEnum
ALTER TYPE "PaperCompilationStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "AgentExecution" ADD COLUMN     "leaseRecoveryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PaperCompilation" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseToken" TEXT;

-- CreateTable
CREATE TABLE "PaperFormattingTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "sourceObjectKey" TEXT NOT NULL,
    "templateVariantId" TEXT NOT NULL,
    "templateSnapshot" JSONB NOT NULL,
    "actualModel" TEXT NOT NULL,
    "billingVersion" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "documentId" TEXT,
    "importId" TEXT,
    "executionId" TEXT,
    "compilationId" TEXT,
    "mappedVersionId" TEXT,
    "completedUnits" INTEGER NOT NULL DEFAULT 0,
    "totalUnits" INTEGER,
    "report" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaperFormattingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperFormattingMappingBatch" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "batchIndex" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "conversationId" TEXT,
    "response" JSONB,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperFormattingMappingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperFormattingTask_documentId_key" ON "PaperFormattingTask"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperFormattingTask_importId_key" ON "PaperFormattingTask"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperFormattingTask_executionId_key" ON "PaperFormattingTask"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperFormattingTask_compilationId_key" ON "PaperFormattingTask"("compilationId");

-- CreateIndex
CREATE INDEX "PaperFormattingTask_userId_status_updatedAt_idx" ON "PaperFormattingTask"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "PaperFormattingTask_status_updatedAt_idx" ON "PaperFormattingTask"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaperFormattingTask_userId_requestKey_key" ON "PaperFormattingTask"("userId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaperFormattingMappingBatch_conversationId_key" ON "PaperFormattingMappingBatch"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperFormattingMappingBatch_taskId_batchIndex_key" ON "PaperFormattingMappingBatch"("taskId", "batchIndex");

-- AddForeignKey
ALTER TABLE "PaperFormattingTask" ADD CONSTRAINT "PaperFormattingTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperFormattingTask" ADD CONSTRAINT "PaperFormattingTask_templateVariantId_fkey" FOREIGN KEY ("templateVariantId") REFERENCES "TemplateVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperFormattingTask" ADD CONSTRAINT "PaperFormattingTask_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PaperDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperFormattingTask" ADD CONSTRAINT "PaperFormattingTask_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PaperImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperFormattingTask" ADD CONSTRAINT "PaperFormattingTask_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperFormattingTask" ADD CONSTRAINT "PaperFormattingTask_compilationId_fkey" FOREIGN KEY ("compilationId") REFERENCES "PaperCompilation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperFormattingMappingBatch" ADD CONSTRAINT "PaperFormattingMappingBatch_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PaperFormattingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

