-- CreateEnum
CREATE TYPE "ResearchSourceRelationType" AS ENUM ('references', 'citations', 'related_work');

-- CreateTable
CREATE TABLE "ResearchSourceRelation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT,
    "sourceId" TEXT NOT NULL,
    "targetSourceId" TEXT,
    "targetCanonicalKey" TEXT,
    "relation" "ResearchSourceRelationType" NOT NULL,
    "provider" TEXT NOT NULL,
    "externalTargetId" TEXT NOT NULL,
    "externalTargetIdType" TEXT,
    "hop" INTEGER NOT NULL DEFAULT 1,
    "edgeKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSourceRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchSourceRelation_workspaceId_createdAt_idx" ON "ResearchSourceRelation"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchSourceRelation_runId_relation_idx" ON "ResearchSourceRelation"("runId", "relation");

-- CreateIndex
CREATE INDEX "ResearchSourceRelation_sourceId_idx" ON "ResearchSourceRelation"("sourceId");

-- CreateIndex
CREATE INDEX "ResearchSourceRelation_targetSourceId_idx" ON "ResearchSourceRelation"("targetSourceId");

-- CreateIndex
CREATE INDEX "ResearchSourceRelation_targetCanonicalKey_idx" ON "ResearchSourceRelation"("targetCanonicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSourceRelation_runId_edgeKey_key" ON "ResearchSourceRelation"("runId", "edgeKey");

-- AddForeignKey
ALTER TABLE "ResearchSourceRelation" ADD CONSTRAINT "ResearchSourceRelation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ResearchWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceRelation" ADD CONSTRAINT "ResearchSourceRelation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceRelation" ADD CONSTRAINT "ResearchSourceRelation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ResearchQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceRelation" ADD CONSTRAINT "ResearchSourceRelation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResearchSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceRelation" ADD CONSTRAINT "ResearchSourceRelation_targetSourceId_fkey" FOREIGN KEY ("targetSourceId") REFERENCES "ResearchSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
