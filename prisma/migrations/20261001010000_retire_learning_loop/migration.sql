-- DropForeignKey
ALTER TABLE "LearningGoal" DROP CONSTRAINT "LearningGoal_userId_fkey";

-- DropForeignKey
ALTER TABLE "LearningGoal" DROP CONSTRAINT "LearningGoal_projectId_fkey";

-- DropForeignKey
ALTER TABLE "LearningGoalRevision" DROP CONSTRAINT "LearningGoalRevision_goalId_fkey";

-- DropForeignKey
ALTER TABLE "LearningGoalRevision" DROP CONSTRAINT "LearningGoalRevision_userId_fkey";

-- DropForeignKey
ALTER TABLE "LearningScope" DROP CONSTRAINT "LearningScope_goalId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeMap" DROP CONSTRAINT "KnowledgeMap_goalId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeMap" DROP CONSTRAINT "KnowledgeMap_scopeId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgePointLineage" DROP CONSTRAINT "KnowledgePointLineage_goalId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgePoint" DROP CONSTRAINT "KnowledgePoint_knowledgeMapId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgePoint" DROP CONSTRAINT "KnowledgePoint_lineageId_fkey";

-- DropForeignKey
ALTER TABLE "SourceAnchor" DROP CONSTRAINT "SourceAnchor_projectId_fkey";

-- DropForeignKey
ALTER TABLE "SourceAnchor" DROP CONSTRAINT "SourceAnchor_fileAssetId_fkey";

-- DropForeignKey
ALTER TABLE "SourceAnchor" DROP CONSTRAINT "SourceAnchor_documentChunkId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgePointSourceAnchor" DROP CONSTRAINT "KnowledgePointSourceAnchor_knowledgePointId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgePointSourceAnchor" DROP CONSTRAINT "KnowledgePointSourceAnchor_sourceAnchorId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItemLineage" DROP CONSTRAINT "PracticeItemLineage_goalId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItem" DROP CONSTRAINT "PracticeItem_goalId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItem" DROP CONSTRAINT "PracticeItem_knowledgeMapId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItem" DROP CONSTRAINT "PracticeItem_lineageId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItemAnswerSpec" DROP CONSTRAINT "PracticeItemAnswerSpec_practiceItemId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItemKnowledgePoint" DROP CONSTRAINT "PracticeItemKnowledgePoint_practiceItemId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItemKnowledgePoint" DROP CONSTRAINT "PracticeItemKnowledgePoint_knowledgePointId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItemSourceAnchor" DROP CONSTRAINT "PracticeItemSourceAnchor_practiceItemId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeItemSourceAnchor" DROP CONSTRAINT "PracticeItemSourceAnchor_sourceAnchorId_fkey";

-- DropForeignKey
ALTER TABLE "LearningSession" DROP CONSTRAINT "LearningSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "LearningSession" DROP CONSTRAINT "LearningSession_goalId_fkey";

-- DropForeignKey
ALTER TABLE "LearningSession" DROP CONSTRAINT "LearningSession_knowledgeMapId_fkey";

-- DropForeignKey
ALTER TABLE "LearningSession" DROP CONSTRAINT "LearningSession_agentExecutionId_fkey";

-- DropForeignKey
ALTER TABLE "LearningSessionItem" DROP CONSTRAINT "LearningSessionItem_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "LearningSessionItem" DROP CONSTRAINT "LearningSessionItem_practiceItemId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeInteractionEvent" DROP CONSTRAINT "PracticeInteractionEvent_sessionItemId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeAttempt" DROP CONSTRAINT "PracticeAttempt_userId_fkey";

-- DropForeignKey
ALTER TABLE "PracticeAttempt" DROP CONSTRAINT "PracticeAttempt_sessionItemId_fkey";

-- DropForeignKey
ALTER TABLE "AttemptEvaluation" DROP CONSTRAINT "AttemptEvaluation_attemptId_fkey";

-- DropForeignKey
ALTER TABLE "AttemptEvaluation" DROP CONSTRAINT "AttemptEvaluation_supersedesEvaluationId_attemptId_fkey";

-- DropForeignKey
ALTER TABLE "AttemptErrorTypeCorrection" DROP CONSTRAINT "AttemptErrorTypeCorrection_evaluationId_fkey";

-- DropForeignKey
ALTER TABLE "AttemptErrorTypeCorrection" DROP CONSTRAINT "AttemptErrorTypeCorrection_userId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgePointProgress" DROP CONSTRAINT "KnowledgePointProgress_userId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgePointProgress" DROP CONSTRAINT "KnowledgePointProgress_goalId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgePointProgress" DROP CONSTRAINT "KnowledgePointProgress_lineageId_fkey";

-- DropForeignKey
ALTER TABLE "LearningProfileReset" DROP CONSTRAINT "LearningProfileReset_userId_fkey";

-- DropForeignKey
ALTER TABLE "LearningProfileReset" DROP CONSTRAINT "LearningProfileReset_goalId_fkey";

-- DropForeignKey
ALTER TABLE "LearningProfileReset" DROP CONSTRAINT "LearningProfileReset_lineageId_fkey";

-- DropForeignKey
ALTER TABLE "StudyPack" DROP CONSTRAINT "StudyPack_userId_fkey";

-- DropForeignKey
ALTER TABLE "StudyPack" DROP CONSTRAINT "StudyPack_goalId_fkey";

-- DropForeignKey
ALTER TABLE "StudyPack" DROP CONSTRAINT "StudyPack_publishedArtifactId_fkey";

-- DropForeignKey
ALTER TABLE "StudyPackSection" DROP CONSTRAINT "StudyPackSection_packId_fkey";

-- DropTable
DROP TABLE "LearningGoal";

-- DropTable
DROP TABLE "LearningGoalRevision";

-- DropTable
DROP TABLE "LearningScope";

-- DropTable
DROP TABLE "KnowledgeMap";

-- DropTable
DROP TABLE "KnowledgePointLineage";

-- DropTable
DROP TABLE "KnowledgePoint";

-- DropTable
DROP TABLE "SourceAnchor";

-- DropTable
DROP TABLE "KnowledgePointSourceAnchor";

-- DropTable
DROP TABLE "PracticeItemLineage";

-- DropTable
DROP TABLE "PracticeItem";

-- DropTable
DROP TABLE "PracticeItemAnswerSpec";

-- DropTable
DROP TABLE "PracticeItemKnowledgePoint";

-- DropTable
DROP TABLE "PracticeItemSourceAnchor";

-- DropTable
DROP TABLE "LearningSession";

-- DropTable
DROP TABLE "LearningSessionItem";

-- DropTable
DROP TABLE "PracticeInteractionEvent";

-- DropTable
DROP TABLE "PracticeAttempt";

-- DropTable
DROP TABLE "AttemptEvaluation";

-- DropTable
DROP TABLE "AttemptErrorTypeCorrection";

-- DropTable
DROP TABLE "KnowledgePointProgress";

-- DropTable
DROP TABLE "LearningProfileReset";

-- DropTable
DROP TABLE "StudyPack";

-- DropTable
DROP TABLE "StudyPackSection";

-- DropEnum
DROP TYPE "LearningGoalStatus";

-- DropEnum
DROP TYPE "LearningScopeStatus";

-- DropEnum
DROP TYPE "LearningMaterialMode";

-- DropEnum
DROP TYPE "PracticeMode";

-- DropEnum
DROP TYPE "PracticeItemType";

-- DropEnum
DROP TYPE "AssistanceLevel";

-- DropEnum
DROP TYPE "EvaluationVerdict";

-- DropEnum
DROP TYPE "MasteryState";

-- DropEnum
DROP TYPE "ContentFreshness";

-- DropEnum
DROP TYPE "LearningSessionMode";

-- DropEnum
DROP TYPE "LearningSessionStatus";

-- DropEnum
DROP TYPE "LearningSessionItemStatus";

-- DropEnum
DROP TYPE "PracticeInteractionType";

-- DropEnum
DROP TYPE "StudyPackOutlineStatus";

-- DropEnum
DROP TYPE "StudyPackSectionStatus";
