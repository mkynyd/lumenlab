-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "projectId" TEXT,
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'queued',
    "checkpoint" JSONB,
    "waitingToolExecutionId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastEventSequence" INTEGER NOT NULL DEFAULT 0,
    "failure" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecutionEvent" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentExecution_userId_createdAt_idx" ON "AgentExecution"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentExecution_conversationId_createdAt_idx" ON "AgentExecution"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentExecution_projectId_idx" ON "AgentExecution"("projectId");

-- CreateIndex
CREATE INDEX "AgentExecution_status_scheduledAt_idx" ON "AgentExecution"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AgentExecution_status_leaseExpiresAt_idx" ON "AgentExecution"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AgentExecution_waitingToolExecutionId_idx" ON "AgentExecution"("waitingToolExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecutionEvent_executionId_sequence_key" ON "AgentExecutionEvent"("executionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecutionEvent_executionId_key_key" ON "AgentExecutionEvent"("executionId", "key");

-- CreateIndex
CREATE INDEX "AgentExecutionEvent_executionId_createdAt_idx" ON "AgentExecutionEvent"("executionId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecutionEvent" ADD CONSTRAINT "AgentExecutionEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
