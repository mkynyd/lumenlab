/*
  Warnings:

  - A unique constraint covering the columns `[userMessageId]` on the table `AgentExecution` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[assistantMessageId]` on the table `AgentExecution` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,clientRunKey]` on the table `AgentExecution` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[agentExecutionId,providerToolCallId]` on the table `ToolExecution` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "LearningGoalStatus" AS ENUM ('active', 'paused', 'completed', 'replaced');

-- CreateEnum
CREATE TYPE "LearningScopeStatus" AS ENUM ('draft', 'confirmed');

-- CreateEnum
CREATE TYPE "LearningMaterialMode" AS ENUM ('project_corpus', 'selected_files');

-- CreateEnum
CREATE TYPE "PracticeMode" AS ENUM ('evidence_bearing', 'feedback_only');

-- CreateEnum
CREATE TYPE "PracticeItemType" AS ENUM ('single_choice', 'multiple_choice', 'true_false', 'numeric', 'short_answer', 'long_answer', 'proof', 'open_design');

-- CreateEnum
CREATE TYPE "AssistanceLevel" AS ENUM ('independent', 'hinted', 'answer_exposed');

-- CreateEnum
CREATE TYPE "EvaluationVerdict" AS ENUM ('correct', 'partial', 'incorrect', 'uncertain');

-- CreateEnum
CREATE TYPE "MasteryState" AS ENUM ('new', 'learning', 'mastered');

-- CreateEnum
CREATE TYPE "ContentFreshness" AS ENUM ('current', 'needs_revalidation', 'unsupported');

-- CreateEnum
CREATE TYPE "LearningSessionMode" AS ENUM ('diagnostic', 'review');

-- CreateEnum
CREATE TYPE "LearningSessionStatus" AS ENUM ('draft', 'ready', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "LearningSessionItemStatus" AS ENUM ('pending', 'in_progress', 'completed', 'skipped');

-- CreateEnum
CREATE TYPE "PracticeInteractionType" AS ENUM ('hint_revealed', 'answer_revealed');

-- AlterTable
ALTER TABLE "AgentExecution" ADD COLUMN     "assistantMessageId" TEXT,
ADD COLUMN     "clientRunKey" TEXT,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "userMessageId" TEXT;

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN     "contentFingerprint" TEXT;

-- AlterTable
ALTER TABLE "ToolExecution" ADD COLUMN     "agentExecutionId" TEXT,
ADD COLUMN     "providerToolCallId" TEXT;

-- CreateTable
CREATE TABLE "LearningGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT,
    "targetDate" TIMESTAMP(3),
    "dailyMinutes" INTEGER,
    "status" "LearningGoalStatus" NOT NULL DEFAULT 'active',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningScope" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "LearningScopeStatus" NOT NULL DEFAULT 'draft',
    "definition" JSONB NOT NULL,
    "materialMode" "LearningMaterialMode" NOT NULL,
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "materialGaps" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeMap" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "requestKey" TEXT,
    "generationMetadata" JSONB,
    "sourceFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePointLineage" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "predecessorMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgePointLineage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePoint" (
    "id" TEXT NOT NULL,
    "knowledgeMapId" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "freshness" "ContentFreshness" NOT NULL DEFAULT 'current',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAnchor" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "anchorKey" TEXT NOT NULL,
    "fileAssetId" TEXT,
    "documentChunkId" TEXT,
    "originalFileAssetId" TEXT NOT NULL,
    "originalDocumentChunkId" TEXT,
    "sourceFileName" TEXT NOT NULL,
    "locator" JSONB NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "excerptHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePointSourceAnchor" (
    "knowledgePointId" TEXT NOT NULL,
    "sourceAnchorId" TEXT NOT NULL,

    CONSTRAINT "KnowledgePointSourceAnchor_pkey" PRIMARY KEY ("knowledgePointId","sourceAnchorId")
);

-- CreateTable
CREATE TABLE "PracticeItemLineage" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "predecessorMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeItemLineage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeItem" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "knowledgeMapId" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "PracticeItemType" NOT NULL,
    "options" JSONB,
    "mode" "PracticeMode" NOT NULL,
    "generationMetadata" JSONB,
    "freshness" "ContentFreshness" NOT NULL DEFAULT 'current',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeItemAnswerSpec" (
    "id" TEXT NOT NULL,
    "practiceItemId" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "graderPolicyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeItemAnswerSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeItemKnowledgePoint" (
    "practiceItemId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "PracticeItemKnowledgePoint_pkey" PRIMARY KEY ("practiceItemId","knowledgePointId")
);

-- CreateTable
CREATE TABLE "PracticeItemSourceAnchor" (
    "practiceItemId" TEXT NOT NULL,
    "sourceAnchorId" TEXT NOT NULL,

    CONSTRAINT "PracticeItemSourceAnchor_pkey" PRIMARY KEY ("practiceItemId","sourceAnchorId")
);

-- CreateTable
CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "knowledgeMapId" TEXT NOT NULL,
    "mode" "LearningSessionMode" NOT NULL,
    "status" "LearningSessionStatus" NOT NULL DEFAULT 'draft',
    "idempotencyKey" TEXT,
    "agentExecutionId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSessionItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "practiceItemId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "status" "LearningSessionItemStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSessionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeInteractionEvent" (
    "id" TEXT NOT NULL,
    "sessionItemId" TEXT NOT NULL,
    "type" "PracticeInteractionType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeInteractionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionItemId" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "assistanceLevel" "AssistanceLevel" NOT NULL,
    "spacingSeconds" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptEvaluation" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "verdict" "EvaluationVerdict" NOT NULL,
    "score" DOUBLE PRECISION,
    "rubric" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "errorType" TEXT,
    "reason" TEXT NOT NULL,
    "modelVersion" TEXT,
    "policyVersion" TEXT NOT NULL,
    "supersedesEvaluationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptErrorTypeCorrection" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptErrorTypeCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePointProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "masteryState" "MasteryState" NOT NULL DEFAULT 'new',
    "nextReviewAt" TIMESTAMP(3),
    "policyVersion" TEXT NOT NULL,
    "evidenceAsOf" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgePointProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningGoal_projectId_status_idx" ON "LearningGoal"("projectId", "status");

-- Prisma cannot express PostgreSQL partial unique indexes. This is the
-- concurrency backstop for the service-level goal activation transaction.
CREATE UNIQUE INDEX "LearningGoal_one_active_per_project_key"
ON "LearningGoal"("projectId")
WHERE "status" = 'active';

-- CreateIndex
CREATE INDEX "LearningGoal_userId_createdAt_idx" ON "LearningGoal"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningGoal_userId_idempotencyKey_key" ON "LearningGoal"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LearningScope_goalId_status_idx" ON "LearningScope"("goalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningScope_goalId_version_key" ON "LearningScope"("goalId", "version");

-- CreateIndex
CREATE INDEX "KnowledgeMap_scopeId_idx" ON "KnowledgeMap"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeMap_goalId_version_key" ON "KnowledgeMap"("goalId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeMap_goalId_requestKey_key" ON "KnowledgeMap"("goalId", "requestKey");

-- CreateIndex
CREATE INDEX "KnowledgePointLineage_goalId_idx" ON "KnowledgePointLineage"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePointLineage_goalId_stableKey_key" ON "KnowledgePointLineage"("goalId", "stableKey");

-- CreateIndex
CREATE INDEX "KnowledgePoint_lineageId_idx" ON "KnowledgePoint"("lineageId");

-- CreateIndex
CREATE INDEX "KnowledgePoint_knowledgeMapId_freshness_idx" ON "KnowledgePoint"("knowledgeMapId", "freshness");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePoint_knowledgeMapId_lineageId_key" ON "KnowledgePoint"("knowledgeMapId", "lineageId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePoint_knowledgeMapId_orderIndex_key" ON "KnowledgePoint"("knowledgeMapId", "orderIndex");

-- CreateIndex
CREATE INDEX "SourceAnchor_projectId_idx" ON "SourceAnchor"("projectId");

-- CreateIndex
CREATE INDEX "SourceAnchor_fileAssetId_idx" ON "SourceAnchor"("fileAssetId");

-- CreateIndex
CREATE INDEX "SourceAnchor_documentChunkId_idx" ON "SourceAnchor"("documentChunkId");

-- CreateIndex
CREATE INDEX "SourceAnchor_originalFileAssetId_idx" ON "SourceAnchor"("originalFileAssetId");

-- CreateIndex
CREATE INDEX "SourceAnchor_contentFingerprint_idx" ON "SourceAnchor"("contentFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAnchor_projectId_anchorKey_key" ON "SourceAnchor"("projectId", "anchorKey");

-- CreateIndex
CREATE INDEX "KnowledgePointSourceAnchor_sourceAnchorId_idx" ON "KnowledgePointSourceAnchor"("sourceAnchorId");

-- CreateIndex
CREATE INDEX "PracticeItemLineage_goalId_idx" ON "PracticeItemLineage"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeItemLineage_goalId_stableKey_key" ON "PracticeItemLineage"("goalId", "stableKey");

-- CreateIndex
CREATE INDEX "PracticeItem_goalId_createdAt_idx" ON "PracticeItem"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "PracticeItem_knowledgeMapId_idx" ON "PracticeItem"("knowledgeMapId");

-- CreateIndex
CREATE INDEX "PracticeItem_freshness_idx" ON "PracticeItem"("freshness");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeItem_lineageId_version_key" ON "PracticeItem"("lineageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeItemAnswerSpec_practiceItemId_key" ON "PracticeItemAnswerSpec"("practiceItemId");

-- CreateIndex
CREATE INDEX "PracticeItemKnowledgePoint_knowledgePointId_idx" ON "PracticeItemKnowledgePoint"("knowledgePointId");

-- CreateIndex
CREATE INDEX "PracticeItemSourceAnchor_sourceAnchorId_idx" ON "PracticeItemSourceAnchor"("sourceAnchorId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSession_agentExecutionId_key" ON "LearningSession"("agentExecutionId");

-- CreateIndex
CREATE INDEX "LearningSession_goalId_createdAt_idx" ON "LearningSession"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningSession_userId_status_idx" ON "LearningSession"("userId", "status");

-- CreateIndex
CREATE INDEX "LearningSession_knowledgeMapId_idx" ON "LearningSession"("knowledgeMapId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSession_userId_idempotencyKey_key" ON "LearningSession"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LearningSessionItem_practiceItemId_idx" ON "LearningSessionItem"("practiceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSessionItem_sessionId_orderIndex_key" ON "LearningSessionItem"("sessionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSessionItem_sessionId_practiceItemId_key" ON "LearningSessionItem"("sessionId", "practiceItemId");

-- CreateIndex
CREATE INDEX "PracticeInteractionEvent_sessionItemId_createdAt_idx" ON "PracticeInteractionEvent"("sessionItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeInteractionEvent_sessionItemId_idempotencyKey_key" ON "PracticeInteractionEvent"("sessionItemId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PracticeAttempt_sessionItemId_submittedAt_idx" ON "PracticeAttempt"("sessionItemId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeAttempt_userId_idempotencyKey_key" ON "PracticeAttempt"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptEvaluation_supersedesEvaluationId_key" ON "AttemptEvaluation"("supersedesEvaluationId");

-- CreateIndex
CREATE INDEX "AttemptEvaluation_attemptId_createdAt_idx" ON "AttemptEvaluation"("attemptId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptEvaluation_id_attemptId_key" ON "AttemptEvaluation"("id", "attemptId");

-- CreateIndex
CREATE INDEX "AttemptErrorTypeCorrection_evaluationId_createdAt_idx" ON "AttemptErrorTypeCorrection"("evaluationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptErrorTypeCorrection_userId_idempotencyKey_key" ON "AttemptErrorTypeCorrection"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "KnowledgePointProgress_goalId_masteryState_idx" ON "KnowledgePointProgress"("goalId", "masteryState");

-- CreateIndex
CREATE INDEX "KnowledgePointProgress_userId_nextReviewAt_idx" ON "KnowledgePointProgress"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePointProgress_userId_goalId_lineageId_key" ON "KnowledgePointProgress"("userId", "goalId", "lineageId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_userMessageId_key" ON "AgentExecution"("userMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_assistantMessageId_key" ON "AgentExecution"("assistantMessageId");

-- CreateIndex
CREATE INDEX "AgentExecution_conversationId_status_idx" ON "AgentExecution"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_userId_clientRunKey_key" ON "AgentExecution"("userId", "clientRunKey");

-- Durable transports may detach without cancelling a run. Serialize
-- nonterminal work per conversation to keep message ordering deterministic.
CREATE UNIQUE INDEX "AgentExecution_one_nonterminal_per_conversation_key"
ON "AgentExecution"("conversationId")
WHERE "status" IN ('queued', 'running', 'waiting_approval');

-- CreateIndex
CREATE INDEX "ToolExecution_agentExecutionId_idx" ON "ToolExecution"("agentExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolExecution_agentExecutionId_providerToolCallId_key" ON "ToolExecution"("agentExecutionId", "providerToolCallId");

-- Domain checks reject impossible projections even if a model or service
-- regression reaches the persistence boundary.
ALTER TABLE "LearningGoal"
  ADD CONSTRAINT "LearningGoal_dailyMinutes_check"
  CHECK ("dailyMinutes" IS NULL OR "dailyMinutes" BETWEEN 5 AND 480);

ALTER TABLE "LearningScope"
  ADD CONSTRAINT "LearningScope_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "LearningScope_confirmation_check"
  CHECK (
    ("status" = 'confirmed' AND "confirmedAt" IS NOT NULL)
    OR ("status" = 'draft' AND "confirmedAt" IS NULL)
  );

ALTER TABLE "KnowledgeMap"
  ADD CONSTRAINT "KnowledgeMap_version_check" CHECK ("version" > 0);

ALTER TABLE "KnowledgePoint"
  ADD CONSTRAINT "KnowledgePoint_orderIndex_check" CHECK ("orderIndex" >= 0);

ALTER TABLE "PracticeItem"
  ADD CONSTRAINT "PracticeItem_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "PracticeItem_options_check"
  CHECK (
    ("type" IN ('single_choice', 'multiple_choice') AND "options" IS NOT NULL)
    OR ("type" NOT IN ('single_choice', 'multiple_choice') AND "options" IS NULL)
  );

ALTER TABLE "PracticeItemKnowledgePoint"
  ADD CONSTRAINT "PracticeItemKnowledgePoint_weight_check" CHECK ("weight" > 0);

ALTER TABLE "LearningSessionItem"
  ADD CONSTRAINT "LearningSessionItem_orderIndex_check" CHECK ("orderIndex" >= 0);

ALTER TABLE "PracticeAttempt"
  ADD CONSTRAINT "PracticeAttempt_spacingSeconds_check" CHECK ("spacingSeconds" >= 0);

ALTER TABLE "AttemptEvaluation"
  ADD CONSTRAINT "AttemptEvaluation_score_check"
    CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 1)),
  ADD CONSTRAINT "AttemptEvaluation_confidence_check"
    CHECK ("confidence" >= 0 AND "confidence" <= 1);

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_agentExecutionId_fkey" FOREIGN KEY ("agentExecutionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_userMessageId_fkey" FOREIGN KEY ("userMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_assistantMessageId_fkey" FOREIGN KEY ("assistantMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningGoal" ADD CONSTRAINT "LearningGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningGoal" ADD CONSTRAINT "LearningGoal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningScope" ADD CONSTRAINT "LearningScope_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeMap" ADD CONSTRAINT "KnowledgeMap_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeMap" ADD CONSTRAINT "KnowledgeMap_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "LearningScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointLineage" ADD CONSTRAINT "KnowledgePointLineage_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePoint" ADD CONSTRAINT "KnowledgePoint_knowledgeMapId_fkey" FOREIGN KEY ("knowledgeMapId") REFERENCES "KnowledgeMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePoint" ADD CONSTRAINT "KnowledgePoint_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "KnowledgePointLineage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAnchor" ADD CONSTRAINT "SourceAnchor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAnchor" ADD CONSTRAINT "SourceAnchor_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAnchor" ADD CONSTRAINT "SourceAnchor_documentChunkId_fkey" FOREIGN KEY ("documentChunkId") REFERENCES "DocumentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointSourceAnchor" ADD CONSTRAINT "KnowledgePointSourceAnchor_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointSourceAnchor" ADD CONSTRAINT "KnowledgePointSourceAnchor_sourceAnchorId_fkey" FOREIGN KEY ("sourceAnchorId") REFERENCES "SourceAnchor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemLineage" ADD CONSTRAINT "PracticeItemLineage_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_knowledgeMapId_fkey" FOREIGN KEY ("knowledgeMapId") REFERENCES "KnowledgeMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItem" ADD CONSTRAINT "PracticeItem_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "PracticeItemLineage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemAnswerSpec" ADD CONSTRAINT "PracticeItemAnswerSpec_practiceItemId_fkey" FOREIGN KEY ("practiceItemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemKnowledgePoint" ADD CONSTRAINT "PracticeItemKnowledgePoint_practiceItemId_fkey" FOREIGN KEY ("practiceItemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemKnowledgePoint" ADD CONSTRAINT "PracticeItemKnowledgePoint_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemSourceAnchor" ADD CONSTRAINT "PracticeItemSourceAnchor_practiceItemId_fkey" FOREIGN KEY ("practiceItemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeItemSourceAnchor" ADD CONSTRAINT "PracticeItemSourceAnchor_sourceAnchorId_fkey" FOREIGN KEY ("sourceAnchorId") REFERENCES "SourceAnchor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_knowledgeMapId_fkey" FOREIGN KEY ("knowledgeMapId") REFERENCES "KnowledgeMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_agentExecutionId_fkey" FOREIGN KEY ("agentExecutionId") REFERENCES "AgentExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSessionItem" ADD CONSTRAINT "LearningSessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSessionItem" ADD CONSTRAINT "LearningSessionItem_practiceItemId_fkey" FOREIGN KEY ("practiceItemId") REFERENCES "PracticeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeInteractionEvent" ADD CONSTRAINT "PracticeInteractionEvent_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES "LearningSessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAttempt" ADD CONSTRAINT "PracticeAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAttempt" ADD CONSTRAINT "PracticeAttempt_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES "LearningSessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptEvaluation" ADD CONSTRAINT "AttemptEvaluation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PracticeAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptEvaluation" ADD CONSTRAINT "AttemptEvaluation_supersedesEvaluationId_attemptId_fkey" FOREIGN KEY ("supersedesEvaluationId", "attemptId") REFERENCES "AttemptEvaluation"("id", "attemptId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptErrorTypeCorrection" ADD CONSTRAINT "AttemptErrorTypeCorrection_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "AttemptEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptErrorTypeCorrection" ADD CONSTRAINT "AttemptErrorTypeCorrection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointProgress" ADD CONSTRAINT "KnowledgePointProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointProgress" ADD CONSTRAINT "KnowledgePointProgress_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "LearningGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointProgress" ADD CONSTRAINT "KnowledgePointProgress_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "KnowledgePointLineage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
