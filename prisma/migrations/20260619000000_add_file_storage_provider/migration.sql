ALTER TABLE "FileAsset"
ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'local';

CREATE INDEX "FileAsset_storageProvider_idx" ON "FileAsset"("storageProvider");
