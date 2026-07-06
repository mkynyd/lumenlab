ALTER TABLE "User" ADD COLUMN "avatarStorageProvider" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarObjectKey" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarMimeType" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);
