-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "applicableModes" TEXT[],
    "classifierHints" JSONB NOT NULL,
    "systemPromptAddition" TEXT NOT NULL,
    "recommendedQuickActions" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfileRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfileRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRole" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "classification" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationIntent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "roleId" TEXT,
    "mode" TEXT,
    "classification" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_key_key" ON "UserRole"("key");

-- CreateIndex
CREATE INDEX "UserRole_isActive_priority_idx" ON "UserRole"("isActive", "priority");

-- CreateIndex
CREATE INDEX "UserProfileRole_userId_idx" ON "UserProfileRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfileRole_userId_roleId_key" ON "UserProfileRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "ProjectRole_projectId_idx" ON "ProjectRole"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationIntent_conversationId_key" ON "ConversationIntent"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationIntent_conversationId_idx" ON "ConversationIntent"("conversationId");

-- AddForeignKey
ALTER TABLE "UserProfileRole" ADD CONSTRAINT "UserProfileRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfileRole" ADD CONSTRAINT "UserProfileRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "UserRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRole" ADD CONSTRAINT "ProjectRole_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRole" ADD CONSTRAINT "ProjectRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "UserRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationIntent" ADD CONSTRAINT "ConversationIntent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationIntent" ADD CONSTRAINT "ConversationIntent_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "UserRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
