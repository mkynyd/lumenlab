-- AlterTable
ALTER TABLE "AttemptEvaluation" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "LearningGoalRevision" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT,
    "targetDate" TIMESTAMP(3),
    "dailyMinutes" INTEGER,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningGoalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProfileReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT,
    "lineageId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningProfileReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningGoalRevision_goalId_createdAt_idx" ON "LearningGoalRevision"("goalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningGoalRevision_userId_idempotencyKey_key" ON "LearningGoalRevision"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LearningProfileReset_userId_goalId_createdAt_idx" ON "LearningProfileReset"("userId", "goalId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningProfileReset_userId_lineageId_createdAt_idx" ON "LearningProfileReset"("userId", "lineageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProfileReset_userId_idempotencyKey_key" ON "LearningProfileReset"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptEvaluation_attemptId_idempotencyKey_key" ON "AttemptEvaluation"("attemptId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "LearningGoalRevision" ADD CONSTRAINT "LearningGoalRevision_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningGoalRevision" ADD CONSTRAINT "LearningGoalRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProfileReset" ADD CONSTRAINT "LearningProfileReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProfileReset" ADD CONSTRAINT "LearningProfileReset_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProfileReset" ADD CONSTRAINT "LearningProfileReset_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "KnowledgePointLineage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

