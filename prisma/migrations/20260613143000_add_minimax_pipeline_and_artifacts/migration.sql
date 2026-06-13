ALTER TABLE "ApiKey" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'deepseek';
DROP INDEX IF EXISTS "ApiKey_userId_key";
CREATE UNIQUE INDEX "ApiKey_userId_provider_key" ON "ApiKey"("userId", "provider");
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

ALTER TABLE "FileAsset"
  ADD COLUMN "enhancedContent" TEXT,
  ADD COLUMN "enhancementStatus" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "processingMetadata" JSONB;

CREATE TABLE "Artifact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "conversationId" TEXT,
  "messageId" TEXT,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "format" TEXT NOT NULL DEFAULT 'markdown',
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Artifact_userId_idx" ON "Artifact"("userId");
CREATE INDEX "Artifact_projectId_idx" ON "Artifact"("projectId");
CREATE INDEX "Artifact_conversationId_idx" ON "Artifact"("conversationId");
CREATE INDEX "Artifact_messageId_idx" ON "Artifact"("messageId");
CREATE INDEX "Artifact_type_idx" ON "Artifact"("type");

ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
