-- CreateEnum
CREATE TYPE "ResearchEvidenceOrigin" AS ENUM ('system', 'user');

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "origin" "ResearchEvidenceOrigin" NOT NULL DEFAULT 'system',
ADD COLUMN     "revisionReason" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Evidence_runId_origin_createdAt_idx" ON "Evidence"("runId", "origin", "createdAt");

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
