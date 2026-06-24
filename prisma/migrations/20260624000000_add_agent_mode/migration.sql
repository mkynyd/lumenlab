-- Agent mode: Tool/Skill registries, executions, approvals, audit

-- CreateTable
CREATE TABLE "SkillPackage" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructionsRef" TEXT NOT NULL,
    "allowedTools" TEXT[],
    "allowedRiskLevel" TEXT[],
    "requiredScopes" TEXT[],
    "defaultApprovalPolicy" TEXT NOT NULL,
    "inputContract" JSONB NOT NULL,
    "outputContract" JSONB NOT NULL,
    "dataHandlingPolicy" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "installedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSkill" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "ConversationSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolDefinition" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "isReadOnly" BOOLEAN NOT NULL,
    "hasExternalSideEffect" BOOLEAN NOT NULL,
    "isReversible" BOOLEAN NOT NULL,
    "containsSensitiveData" BOOLEAN NOT NULL,
    "requiresNetwork" BOOLEAN NOT NULL,
    "estimatedCost" TEXT,
    "defaultApprovalMode" TEXT NOT NULL,
    "allowedSkillIds" TEXT[],
    "auditLevel" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "installedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT,
    "skillVersion" TEXT,
    "toolId" TEXT NOT NULL,
    "normalizedArguments" JSONB NOT NULL,
    "argumentsHash" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approvalSnapshot" JSONB,
    "approvalTokenHash" TEXT,
    "approvalScope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "errorSummary" JSONB,
    "auditMetadata" JSONB,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "argumentsHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "toolExecutionId" TEXT,
    "skillId" TEXT,
    "toolId" TEXT,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserToolPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "approvalMode" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserToolPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillPackage_skillId_version_key" ON "SkillPackage"("skillId", "version");
CREATE INDEX "SkillPackage_isSystem_skillId_idx" ON "SkillPackage"("isSystem", "skillId");

CREATE INDEX "ConversationSkill_conversationId_activatedAt_idx" ON "ConversationSkill"("conversationId", "activatedAt");
CREATE INDEX "ConversationSkill_skillId_version_idx" ON "ConversationSkill"("skillId", "version");

CREATE UNIQUE INDEX "ToolDefinition_toolId_key" ON "ToolDefinition"("toolId");

CREATE INDEX "ToolExecution_conversationId_createdAt_idx" ON "ToolExecution"("conversationId", "createdAt");
CREATE INDEX "ToolExecution_userId_status_idx" ON "ToolExecution"("userId", "status");
CREATE INDEX "ToolExecution_status_expiresAt_idx" ON "ToolExecution"("status", "expiresAt");

CREATE UNIQUE INDEX "ApprovalToken_tokenHash_key" ON "ApprovalToken"("tokenHash");
CREATE INDEX "ApprovalToken_tokenHash_idx" ON "ApprovalToken"("tokenHash");
CREATE INDEX "ApprovalToken_userId_expiresAt_idx" ON "ApprovalToken"("userId", "expiresAt");

CREATE INDEX "AgentAuditLog_userId_createdAt_idx" ON "AgentAuditLog"("userId", "createdAt");
CREATE INDEX "AgentAuditLog_conversationId_createdAt_idx" ON "AgentAuditLog"("conversationId", "createdAt");
CREATE INDEX "AgentAuditLog_toolExecutionId_idx" ON "AgentAuditLog"("toolExecutionId");

CREATE UNIQUE INDEX "UserToolPreference_userId_toolId_key" ON "UserToolPreference"("userId", "toolId");