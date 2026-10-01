-- CreateTable
CREATE TABLE "StudyCollection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "grade" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "major" TEXT NOT NULL DEFAULT '',
    "exam" TEXT NOT NULL DEFAULT '',
    "syllabus" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MistakeNotebook" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MistakeNotebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MistakeItem" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sourceOrdinal" TEXT,
    "prompt" TEXT NOT NULL DEFAULT '',
    "assets" JSONB NOT NULL DEFAULT '[]',
    "solution" JSONB,
    "verification" JSONB,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bankQuestionId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MistakeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT '等待处理',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "temporaryKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "course" TEXT NOT NULL DEFAULT '',
    "deadline" TIMESTAMP(3) NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "termStart" TIMESTAMP(3),
    "periods" JSONB NOT NULL DEFAULT '[]',
    "availability" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankPaper" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "exam" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankQuestion" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "ordinal" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "assets" JSONB NOT NULL DEFAULT '[]',
    "solution" JSONB,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "BankQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyCollection_userId_updatedAt_idx" ON "StudyCollection"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "MistakeNotebook_collectionId_idx" ON "MistakeNotebook"("collectionId");

-- CreateIndex
CREATE INDEX "MistakeItem_notebookId_createdAt_idx" ON "MistakeItem"("notebookId", "createdAt");

-- CreateIndex
CREATE INDEX "StudyJob_status_leaseUntil_idx" ON "StudyJob"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "StudyJob_userId_createdAt_idx" ON "StudyJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StudyJob_expiresAt_idx" ON "StudyJob"("expiresAt");

-- CreateIndex
CREATE INDEX "StudyTask_userId_completed_deadline_idx" ON "StudyTask"("userId", "completed", "deadline");

-- CreateIndex
CREATE INDEX "StudyEvent_userId_start_end_idx" ON "StudyEvent"("userId", "start", "end");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPreferences_userId_key" ON "StudyPreferences"("userId");

-- CreateIndex
CREATE INDEX "BankPaper_verified_stage_subject_exam_year_idx" ON "BankPaper"("verified", "stage", "subject", "exam", "year");

-- CreateIndex
CREATE INDEX "BankQuestion_contentHash_idx" ON "BankQuestion"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "BankQuestion_paperId_ordinal_key" ON "BankQuestion"("paperId", "ordinal");

-- AddForeignKey
ALTER TABLE "StudyCollection" ADD CONSTRAINT "StudyCollection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MistakeNotebook" ADD CONSTRAINT "MistakeNotebook_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "StudyCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MistakeItem" ADD CONSTRAINT "MistakeItem_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "MistakeNotebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MistakeItem" ADD CONSTRAINT "MistakeItem_bankQuestionId_fkey" FOREIGN KEY ("bankQuestionId") REFERENCES "BankQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyJob" ADD CONSTRAINT "StudyJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyEvent" ADD CONSTRAINT "StudyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPreferences" ADD CONSTRAINT "StudyPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankQuestion" ADD CONSTRAINT "BankQuestion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "BankPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
