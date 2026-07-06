-- CreateTable
CREATE TABLE "FileParseJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stage" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "strategy" TEXT,
    "costEstimate" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileParseJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileParseJob_fileAssetId_key" ON "FileParseJob"("fileAssetId");

-- CreateIndex
CREATE INDEX "FileParseJob_userId_idx" ON "FileParseJob"("userId");

-- CreateIndex
CREATE INDEX "FileParseJob_status_idx" ON "FileParseJob"("status");

-- CreateIndex
CREATE INDEX "FileParseJob_fileAssetId_idx" ON "FileParseJob"("fileAssetId");

-- AddForeignKey
ALTER TABLE "FileParseJob" ADD CONSTRAINT "FileParseJob_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
