-- Agent mode: add Reference / ReferenceListItem tables for citation manager

-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "doi" TEXT,
    "arxivId" TEXT,
    "title" TEXT NOT NULL,
    "authors" TEXT[],
    "year" INTEGER,
    "venue" TEXT,
    "url" TEXT,
    "rawMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceListItem" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'apa',
    "inlineMarker" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reference_userId_idx" ON "Reference"("userId");
CREATE INDEX "Reference_projectId_idx" ON "Reference"("projectId");
CREATE INDEX "Reference_arxivId_idx" ON "Reference"("arxivId");
CREATE INDEX "Reference_doi_idx" ON "Reference"("doi");

CREATE UNIQUE INDEX "ReferenceListItem_artifactId_referenceId_key" ON "ReferenceListItem"("artifactId", "referenceId");
CREATE INDEX "ReferenceListItem_artifactId_idx" ON "ReferenceListItem"("artifactId");
CREATE INDEX "ReferenceListItem_referenceId_idx" ON "ReferenceListItem"("referenceId");

-- AddForeignKey
ALTER TABLE "ReferenceListItem" ADD CONSTRAINT "ReferenceListItem_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferenceListItem" ADD CONSTRAINT "ReferenceListItem_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "Reference"("id") ON DELETE CASCADE ON UPDATE CASCADE;