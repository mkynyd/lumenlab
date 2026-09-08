-- 任务 08.1：消息附件持久化元数据。纯新增表，不改写任何既有行。
-- 对象先落对象存储、行先以 pending 存在，用户消息落库后再绑定 messageId。
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT,
    "clientRunKey" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "contentHash" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "storagePath" TEXT NOT NULL,
    "thumbnailProvider" TEXT,
    "thumbnailPath" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageAttachment_userId_clientRunKey_position_key" ON "MessageAttachment"("userId", "clientRunKey", "position");
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");
CREATE INDEX "MessageAttachment_userId_status_idx" ON "MessageAttachment"("userId", "status");
CREATE INDEX "MessageAttachment_createdAt_idx" ON "MessageAttachment"("createdAt");
CREATE INDEX "MessageAttachment_contentHash_idx" ON "MessageAttachment"("contentHash");

ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
