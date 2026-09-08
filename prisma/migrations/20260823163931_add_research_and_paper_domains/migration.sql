-- CreateEnum
CREATE TYPE "ResearchWorkspaceStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('planning', 'awaiting_confirmation', 'queued', 'researching', 'evaluating', 'synthesizing', 'verifying', 'completed', 'cancelled', 'failed', 'awaiting_scope_confirmation');

-- CreateEnum
CREATE TYPE "ResearchQuestionStatus" AS ENUM ('pending', 'researching', 'evaluating', 'resolved', 'partially_resolved', 'unresolved', 'controversial');

-- CreateEnum
CREATE TYPE "ResearchTaskStatus" AS ENUM ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled', 'retrying');

-- CreateEnum
CREATE TYPE "ResearchTaskKind" AS ENUM ('planner', 'researcher', 'evaluator', 'replanner', 'synthesizer', 'verifier');

-- CreateEnum
CREATE TYPE "ResearchPriority" AS ENUM ('critical', 'important', 'supporting');

-- CreateEnum
CREATE TYPE "ResearchBudgetProfile" AS ENUM ('quick', 'deep', 'comprehensive');

-- CreateEnum
CREATE TYPE "ResearchSourceKind" AS ENUM ('web', 'academic_paper', 'arxiv', 'doi', 'pmid', 'github', 'dataset', 'official_document', 'book', 'project_file', 'uploaded_file');

-- CreateEnum
CREATE TYPE "ResearchSourceSnapshotStatus" AS ENUM ('fetched', 'failed');

-- CreateEnum
CREATE TYPE "ResearchEvidenceStatus" AS ENUM ('active', 'superseded', 'disputed', 'invalidated');

-- CreateEnum
CREATE TYPE "ResearchEvidenceType" AS ENUM ('direct_quote', 'paraphrase', 'dataset_measurement', 'project_context', 'expert_assessment');

-- CreateEnum
CREATE TYPE "ResearchClaimStatus" AS ENUM ('active', 'superseded', 'disputed');

-- CreateEnum
CREATE TYPE "ClaimEvidenceRelationType" AS ENUM ('supports', 'contradicts', 'qualifies', 'context');

-- CreateEnum
CREATE TYPE "ResearchVerificationStatus" AS ENUM ('pending', 'verified', 'needs_qualification', 'unsupported', 'conflicted');

-- CreateEnum
CREATE TYPE "ResearchDirectiveStatus" AS ENUM ('pending', 'applied', 'needs_confirmation', 'rejected');

-- CreateEnum
CREATE TYPE "PaperWorkspaceStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "PaperDocumentVersionStatus" AS ENUM ('draft', 'published', 'superseded');

-- CreateEnum
CREATE TYPE "PaperDocumentPatchStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "PaperImportStatus" AS ENUM ('uploaded', 'parsing', 'awaiting_confirmation', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "PaperCompilationStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "PaperResearchMaterialType" AS ENUM ('source', 'claim', 'evidence');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'chat';

-- AlterTable
ALTER TABLE "Reference" ADD COLUMN     "paperWorkspaceId" TEXT;

-- CreateTable
CREATE TABLE "ResearchDomainProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourcePolicy" JSONB NOT NULL,
    "evidencePolicy" JSONB NOT NULL,
    "citationPolicy" JSONB NOT NULL,
    "outputPolicy" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchDomainProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchWorkspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "domainProfileKey" TEXT NOT NULL DEFAULT 'general',
    "budgetProfile" "ResearchBudgetProfile" NOT NULL DEFAULT 'deep',
    "status" "ResearchWorkspaceStatus" NOT NULL DEFAULT 'active',
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "followUpOfId" TEXT,
    "agentExecutionId" TEXT,
    "planVersionId" TEXT,
    "question" TEXT NOT NULL,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'planning',
    "budgetSnapshot" JSONB,
    "modelConfiguration" JSONB,
    "checkpoint" JSONB,
    "metrics" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPlanVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT,
    "version" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "reason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchQuestion" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "priority" "ResearchPriority" NOT NULL DEFAULT 'important',
    "status" "ResearchQuestionStatus" NOT NULL DEFAULT 'pending',
    "orderIndex" INTEGER NOT NULL,
    "completionCriteria" JSONB NOT NULL,
    "sourceStrategy" JSONB,
    "qualitySummary" JSONB,
    "researchAttempts" INTEGER NOT NULL DEFAULT 0,
    "evaluateAttempts" INTEGER NOT NULL DEFAULT 0,
    "replanAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchTask" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT,
    "parentTaskId" TEXT,
    "kind" "ResearchTaskKind" NOT NULL,
    "status" "ResearchTaskStatus" NOT NULL DEFAULT 'pending',
    "priority" "ResearchPriority" NOT NULL DEFAULT 'important',
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "payload" JSONB,
    "checkpoint" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchUserDirective" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'normal',
    "status" "ResearchDirectiveStatus" NOT NULL DEFAULT 'pending',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchUserDirective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ResearchSourceKind" NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "title" TEXT,
    "doi" TEXT,
    "arxivId" TEXT,
    "pmid" TEXT,
    "canonicalUrl" TEXT,
    "aliases" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSourceCandidate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT,
    "url" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "researchSourceId" TEXT,

    CONSTRAINT "ResearchSourceCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSourceSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "rawContentLocation" JSONB,
    "excerpt" TEXT,
    "metadata" JSONB,
    "status" "ResearchSourceSnapshotStatus" NOT NULL DEFAULT 'fetched',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT,
    "sourceSnapshotId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "locator" JSONB NOT NULL,
    "excerpt" TEXT NOT NULL,
    "evidenceType" "ResearchEvidenceType" NOT NULL,
    "provenance" JSONB,
    "status" "ResearchEvidenceStatus" NOT NULL DEFAULT 'active',
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT,
    "statement" TEXT NOT NULL,
    "status" "ResearchClaimStatus" NOT NULL DEFAULT 'active',
    "userEdited" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" "ResearchVerificationStatus" NOT NULL DEFAULT 'pending',
    "quality" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidenceRelation" (
    "claimId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "relation" "ClaimEvidenceRelationType" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvidenceRelation_pkey" PRIMARY KEY ("claimId","evidenceId")
);

-- CreateTable
CREATE TABLE "ResearchReportSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "planVersionId" TEXT,
    "reportDocument" JSONB NOT NULL,
    "claimSnapshots" JSONB NOT NULL,
    "evidenceIds" TEXT[],
    "sourceSnapshotIds" TEXT[],
    "citationMap" JSONB NOT NULL,
    "coverageSummary" JSONB NOT NULL,
    "verificationSummary" JSONB NOT NULL,
    "modelConfiguration" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperWorkspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PaperWorkspaceStatus" NOT NULL DEFAULT 'active',
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperDocument" (
    "id" TEXT NOT NULL,
    "paperWorkspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '未命名论文',
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PaperDocumentVersionStatus" NOT NULL DEFAULT 'draft',
    "schemaVersion" TEXT NOT NULL DEFAULT '1',
    "content" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "PaperDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperDocumentPatch" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "baseVersionId" TEXT,
    "status" "PaperDocumentPatchStatus" NOT NULL DEFAULT 'pending',
    "patch" JSONB NOT NULL,
    "summary" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "PaperDocumentPatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateRegistryEntry" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "university" TEXT NOT NULL,
    "universityType" TEXT,
    "degreeType" TEXT,
    "year" TEXT,
    "specVersion" TEXT,
    "format" TEXT NOT NULL,
    "sourceType" TEXT,
    "officialSpecUrl" TEXT,
    "repositoryUrl" TEXT,
    "repositoryHost" TEXT,
    "sourceVersion" TEXT,
    "engine" TEXT,
    "entryFile" TEXT,
    "documentClass" TEXT,
    "bibliography" TEXT,
    "license" TEXT,
    "recommendationLevel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Unverified',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateRegistryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVariant" (
    "id" TEXT NOT NULL,
    "registryEntryId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "pinnedUpstreamSnapshot" JSONB NOT NULL,
    "adapterId" TEXT NOT NULL,
    "validation" JSONB,
    "sample" JSONB,
    "status" TEXT NOT NULL DEFAULT 'Unverified',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateBinding" (
    "id" TEXT NOT NULL,
    "paperDocumentId" TEXT NOT NULL,
    "templateVariantId" TEXT NOT NULL,
    "lockedVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateBindingVersion" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "manifestSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateBindingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperCompilation" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "bindingVersionId" TEXT,
    "status" "PaperCompilationStatus" NOT NULL DEFAULT 'queued',
    "engine" TEXT,
    "jobKey" TEXT NOT NULL,
    "pdfStorageProvider" TEXT,
    "pdfObjectKey" TEXT,
    "sourceStorageProvider" TEXT,
    "sourceObjectKey" TEXT,
    "errorLog" JSONB,
    "syncTex" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "artifactId" TEXT,

    CONSTRAINT "PaperCompilation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperImport" (
    "id" TEXT NOT NULL,
    "paperDocumentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "status" "PaperImportStatus" NOT NULL DEFAULT 'uploaded',
    "originalProvider" TEXT,
    "originalObjectKey" TEXT,
    "sourceHash" TEXT,
    "importReport" JSONB,
    "generatedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperImportSnapshot" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawLocation" JSONB,
    "parserVersion" TEXT NOT NULL,
    "parsedOutline" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperImportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperResearchLink" (
    "id" TEXT NOT NULL,
    "paperWorkspaceId" TEXT NOT NULL,
    "researchWorkspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperResearchLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperResearchMaterial" (
    "id" TEXT NOT NULL,
    "paperWorkspaceId" TEXT NOT NULL,
    "researchWorkspaceId" TEXT NOT NULL,
    "researchRunId" TEXT,
    "researchReportId" TEXT,
    "sourceId" TEXT,
    "claimId" TEXT,
    "evidenceId" TEXT,
    "type" "PaperResearchMaterialType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperResearchMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDomainProfile_key_key" ON "ResearchDomainProfile"("key");

-- CreateIndex
CREATE INDEX "ResearchDomainProfile_status_idx" ON "ResearchDomainProfile"("status");

-- CreateIndex
CREATE INDEX "ResearchWorkspace_userId_updatedAt_idx" ON "ResearchWorkspace"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchWorkspace_projectId_idx" ON "ResearchWorkspace"("projectId");

-- CreateIndex
CREATE INDEX "ResearchWorkspace_status_updatedAt_idx" ON "ResearchWorkspace"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_agentExecutionId_key" ON "ResearchRun"("agentExecutionId");

-- CreateIndex
CREATE INDEX "ResearchRun_workspaceId_createdAt_idx" ON "ResearchRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_userId_status_updatedAt_idx" ON "ResearchRun"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchRun_status_updatedAt_idx" ON "ResearchRun"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchRun_followUpOfId_idx" ON "ResearchRun"("followUpOfId");

-- CreateIndex
CREATE INDEX "ResearchPlanVersion_runId_createdAt_idx" ON "ResearchPlanVersion"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPlanVersion_workspaceId_version_key" ON "ResearchPlanVersion"("workspaceId", "version");

-- CreateIndex
CREATE INDEX "ResearchQuestion_runId_status_idx" ON "ResearchQuestion"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchQuestion_runId_key_key" ON "ResearchQuestion"("runId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchQuestion_runId_orderIndex_key" ON "ResearchQuestion"("runId", "orderIndex");

-- CreateIndex
CREATE INDEX "ResearchTask_runId_status_priority_idx" ON "ResearchTask"("runId", "status", "priority");

-- CreateIndex
CREATE INDEX "ResearchTask_questionId_status_idx" ON "ResearchTask"("questionId", "status");

-- CreateIndex
CREATE INDEX "ResearchTask_parentTaskId_idx" ON "ResearchTask"("parentTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchTask_runId_idempotencyKey_key" ON "ResearchTask"("runId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ResearchUserDirective_workspaceId_createdAt_idx" ON "ResearchUserDirective"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchUserDirective_runId_status_idx" ON "ResearchUserDirective"("runId", "status");

-- CreateIndex
CREATE INDEX "ResearchSource_userId_canonicalKey_idx" ON "ResearchSource"("userId", "canonicalKey");

-- CreateIndex
CREATE INDEX "ResearchSource_doi_idx" ON "ResearchSource"("doi");

-- CreateIndex
CREATE INDEX "ResearchSource_arxivId_idx" ON "ResearchSource"("arxivId");

-- CreateIndex
CREATE INDEX "ResearchSource_pmid_idx" ON "ResearchSource"("pmid");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_workspaceId_canonicalKey_key" ON "ResearchSource"("workspaceId", "canonicalKey");

-- CreateIndex
CREATE INDEX "ResearchSourceCandidate_workspaceId_discoveredAt_idx" ON "ResearchSourceCandidate"("workspaceId", "discoveredAt");

-- CreateIndex
CREATE INDEX "ResearchSourceCandidate_runId_status_idx" ON "ResearchSourceCandidate"("runId", "status");

-- CreateIndex
CREATE INDEX "ResearchSourceCandidate_questionId_idx" ON "ResearchSourceCandidate"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSourceCandidate_runId_provider_externalId_key" ON "ResearchSourceCandidate"("runId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "ResearchSourceSnapshot_workspaceId_retrievedAt_idx" ON "ResearchSourceSnapshot"("workspaceId", "retrievedAt");

-- CreateIndex
CREATE INDEX "ResearchSourceSnapshot_sourceId_retrievedAt_idx" ON "ResearchSourceSnapshot"("sourceId", "retrievedAt");

-- CreateIndex
CREATE INDEX "ResearchSourceSnapshot_runId_idx" ON "ResearchSourceSnapshot"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSourceSnapshot_runId_sourceId_contentHash_key" ON "ResearchSourceSnapshot"("runId", "sourceId", "contentHash");

-- CreateIndex
CREATE INDEX "Evidence_workspaceId_status_createdAt_idx" ON "Evidence"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Evidence_runId_questionId_idx" ON "Evidence"("runId", "questionId");

-- CreateIndex
CREATE INDEX "Evidence_sourceSnapshotId_idx" ON "Evidence"("sourceSnapshotId");

-- CreateIndex
CREATE INDEX "Evidence_supersedesId_idx" ON "Evidence"("supersedesId");

-- CreateIndex
CREATE INDEX "Claim_workspaceId_status_createdAt_idx" ON "Claim"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Claim_runId_questionId_idx" ON "Claim"("runId", "questionId");

-- CreateIndex
CREATE INDEX "Claim_verificationStatus_idx" ON "Claim"("verificationStatus");

-- CreateIndex
CREATE INDEX "ClaimEvidenceRelation_evidenceId_idx" ON "ClaimEvidenceRelation"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchReportSnapshot_runId_key" ON "ResearchReportSnapshot"("runId");

-- CreateIndex
CREATE INDEX "ResearchReportSnapshot_workspaceId_generatedAt_idx" ON "ResearchReportSnapshot"("workspaceId", "generatedAt");

-- CreateIndex
CREATE INDEX "ResearchReportSnapshot_planVersionId_idx" ON "ResearchReportSnapshot"("planVersionId");

-- CreateIndex
CREATE INDEX "PaperWorkspace_userId_updatedAt_idx" ON "PaperWorkspace"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "PaperWorkspace_projectId_idx" ON "PaperWorkspace"("projectId");

-- CreateIndex
CREATE INDEX "PaperWorkspace_status_updatedAt_idx" ON "PaperWorkspace"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaperDocument_paperWorkspaceId_key" ON "PaperDocument"("paperWorkspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperDocument_currentVersionId_key" ON "PaperDocument"("currentVersionId");

-- CreateIndex
CREATE INDEX "PaperDocument_userId_updatedAt_idx" ON "PaperDocument"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "PaperDocumentVersion_documentId_createdAt_idx" ON "PaperDocumentVersion"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaperDocumentVersion_status_idx" ON "PaperDocumentVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaperDocumentVersion_documentId_version_key" ON "PaperDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "PaperDocumentPatch_documentId_createdAt_idx" ON "PaperDocumentPatch"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaperDocumentPatch_baseVersionId_idx" ON "PaperDocumentPatch"("baseVersionId");

-- CreateIndex
CREATE INDEX "PaperDocumentPatch_status_idx" ON "PaperDocumentPatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateRegistryEntry_externalId_key" ON "TemplateRegistryEntry"("externalId");

-- CreateIndex
CREATE INDEX "TemplateRegistryEntry_university_idx" ON "TemplateRegistryEntry"("university");

-- CreateIndex
CREATE INDEX "TemplateRegistryEntry_degreeType_year_idx" ON "TemplateRegistryEntry"("degreeType", "year");

-- CreateIndex
CREATE INDEX "TemplateRegistryEntry_format_status_idx" ON "TemplateRegistryEntry"("format", "status");

-- CreateIndex
CREATE INDEX "TemplateRegistryEntry_recommendationLevel_idx" ON "TemplateRegistryEntry"("recommendationLevel");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVariant_variantKey_key" ON "TemplateVariant"("variantKey");

-- CreateIndex
CREATE INDEX "TemplateVariant_registryEntryId_idx" ON "TemplateVariant"("registryEntryId");

-- CreateIndex
CREATE INDEX "TemplateVariant_status_idx" ON "TemplateVariant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateBinding_paperDocumentId_key" ON "TemplateBinding"("paperDocumentId");

-- CreateIndex
CREATE INDEX "TemplateBinding_templateVariantId_idx" ON "TemplateBinding"("templateVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateBindingVersion_bindingId_version_key" ON "TemplateBindingVersion"("bindingId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PaperCompilation_jobKey_key" ON "PaperCompilation"("jobKey");

-- CreateIndex
CREATE INDEX "PaperCompilation_documentVersionId_createdAt_idx" ON "PaperCompilation"("documentVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "PaperCompilation_status_createdAt_idx" ON "PaperCompilation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaperCompilation_bindingVersionId_idx" ON "PaperCompilation"("bindingVersionId");

-- CreateIndex
CREATE INDEX "PaperImport_paperDocumentId_createdAt_idx" ON "PaperImport"("paperDocumentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaperImport_userId_status_idx" ON "PaperImport"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaperImportSnapshot_importId_contentHash_key" ON "PaperImportSnapshot"("importId", "contentHash");

-- CreateIndex
CREATE INDEX "PaperResearchLink_researchWorkspaceId_idx" ON "PaperResearchLink"("researchWorkspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperResearchLink_paperWorkspaceId_researchWorkspaceId_key" ON "PaperResearchLink"("paperWorkspaceId", "researchWorkspaceId");

-- CreateIndex
CREATE INDEX "PaperResearchMaterial_paperWorkspaceId_createdAt_idx" ON "PaperResearchMaterial"("paperWorkspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PaperResearchMaterial_researchWorkspaceId_createdAt_idx" ON "PaperResearchMaterial"("researchWorkspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PaperResearchMaterial_sourceId_idx" ON "PaperResearchMaterial"("sourceId");

-- CreateIndex
CREATE INDEX "PaperResearchMaterial_claimId_idx" ON "PaperResearchMaterial"("claimId");

-- CreateIndex
CREATE INDEX "PaperResearchMaterial_evidenceId_idx" ON "PaperResearchMaterial"("evidenceId");

-- CreateIndex
CREATE INDEX "Reference_paperWorkspaceId_idx" ON "Reference"("paperWorkspaceId");

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_paperWorkspaceId_fkey" FOREIGN KEY ("paperWorkspaceId") REFERENCES "PaperWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchWorkspace" ADD CONSTRAINT "ResearchWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchWorkspace" ADD CONSTRAINT "ResearchWorkspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_followUpOfId_fkey" FOREIGN KEY ("followUpOfId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_agentExecutionId_fkey" FOREIGN KEY ("agentExecutionId") REFERENCES "AgentExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "ResearchPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlanVersion" ADD CONSTRAINT "ResearchPlanVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlanVersion" ADD CONSTRAINT "ResearchPlanVersion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchQuestion" ADD CONSTRAINT "ResearchQuestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ResearchQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "ResearchTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchUserDirective" ADD CONSTRAINT "ResearchUserDirective_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchUserDirective" ADD CONSTRAINT "ResearchUserDirective_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchUserDirective" ADD CONSTRAINT "ResearchUserDirective_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceCandidate" ADD CONSTRAINT "ResearchSourceCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceCandidate" ADD CONSTRAINT "ResearchSourceCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceCandidate" ADD CONSTRAINT "ResearchSourceCandidate_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ResearchQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceCandidate" ADD CONSTRAINT "ResearchSourceCandidate_researchSourceId_fkey" FOREIGN KEY ("researchSourceId") REFERENCES "ResearchSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceSnapshot" ADD CONSTRAINT "ResearchSourceSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceSnapshot" ADD CONSTRAINT "ResearchSourceSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceSnapshot" ADD CONSTRAINT "ResearchSourceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ResearchQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "ResearchSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ResearchQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceRelation" ADD CONSTRAINT "ClaimEvidenceRelation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceRelation" ADD CONSTRAINT "ClaimEvidenceRelation_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReportSnapshot" ADD CONSTRAINT "ResearchReportSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReportSnapshot" ADD CONSTRAINT "ResearchReportSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReportSnapshot" ADD CONSTRAINT "ResearchReportSnapshot_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "ResearchPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperWorkspace" ADD CONSTRAINT "PaperWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperWorkspace" ADD CONSTRAINT "PaperWorkspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDocument" ADD CONSTRAINT "PaperDocument_paperWorkspaceId_fkey" FOREIGN KEY ("paperWorkspaceId") REFERENCES "PaperWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDocument" ADD CONSTRAINT "PaperDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDocument" ADD CONSTRAINT "PaperDocument_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "PaperDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDocumentVersion" ADD CONSTRAINT "PaperDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PaperDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDocumentVersion" ADD CONSTRAINT "PaperDocumentVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDocumentPatch" ADD CONSTRAINT "PaperDocumentPatch_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PaperDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDocumentPatch" ADD CONSTRAINT "PaperDocumentPatch_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "PaperDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDocumentPatch" ADD CONSTRAINT "PaperDocumentPatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVariant" ADD CONSTRAINT "TemplateVariant_registryEntryId_fkey" FOREIGN KEY ("registryEntryId") REFERENCES "TemplateRegistryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateBinding" ADD CONSTRAINT "TemplateBinding_paperDocumentId_fkey" FOREIGN KEY ("paperDocumentId") REFERENCES "PaperDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateBinding" ADD CONSTRAINT "TemplateBinding_templateVariantId_fkey" FOREIGN KEY ("templateVariantId") REFERENCES "TemplateVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateBindingVersion" ADD CONSTRAINT "TemplateBindingVersion_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "TemplateBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperCompilation" ADD CONSTRAINT "PaperCompilation_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "PaperDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperCompilation" ADD CONSTRAINT "PaperCompilation_bindingVersionId_fkey" FOREIGN KEY ("bindingVersionId") REFERENCES "TemplateBindingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperCompilation" ADD CONSTRAINT "PaperCompilation_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperImport" ADD CONSTRAINT "PaperImport_paperDocumentId_fkey" FOREIGN KEY ("paperDocumentId") REFERENCES "PaperDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperImport" ADD CONSTRAINT "PaperImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperImport" ADD CONSTRAINT "PaperImport_generatedVersionId_fkey" FOREIGN KEY ("generatedVersionId") REFERENCES "PaperDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperImportSnapshot" ADD CONSTRAINT "PaperImportSnapshot_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PaperImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchLink" ADD CONSTRAINT "PaperResearchLink_paperWorkspaceId_fkey" FOREIGN KEY ("paperWorkspaceId") REFERENCES "PaperWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchLink" ADD CONSTRAINT "PaperResearchLink_researchWorkspaceId_fkey" FOREIGN KEY ("researchWorkspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchMaterial" ADD CONSTRAINT "PaperResearchMaterial_paperWorkspaceId_fkey" FOREIGN KEY ("paperWorkspaceId") REFERENCES "PaperWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchMaterial" ADD CONSTRAINT "PaperResearchMaterial_researchWorkspaceId_fkey" FOREIGN KEY ("researchWorkspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchMaterial" ADD CONSTRAINT "PaperResearchMaterial_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchMaterial" ADD CONSTRAINT "PaperResearchMaterial_researchReportId_fkey" FOREIGN KEY ("researchReportId") REFERENCES "ResearchReportSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchMaterial" ADD CONSTRAINT "PaperResearchMaterial_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchMaterial" ADD CONSTRAINT "PaperResearchMaterial_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchMaterial" ADD CONSTRAINT "PaperResearchMaterial_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
