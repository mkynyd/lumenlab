-- AlterTable
ALTER TABLE "User"
ADD COLUMN "accessStatus" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "credentialProfileId" TEXT;

-- CreateTable
CREATE TABLE "CredentialProfile" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CredentialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "credentialProfileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "validatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationCode" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "credentialProfileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "codeDigest" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "maxRedemptions" INTEGER NOT NULL,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "publishedVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationRedemption" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistrationRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationPublication" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "sourceIssuedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistrationPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationSyncNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistrationSyncNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CredentialProfile_externalId_key" ON "CredentialProfile"("externalId");
CREATE INDEX "CredentialProfile_status_idx" ON "CredentialProfile"("status");
CREATE UNIQUE INDEX "ProviderCredential_externalId_key" ON "ProviderCredential"("externalId");
CREATE UNIQUE INDEX "ProviderCredential_credentialProfileId_provider_key" ON "ProviderCredential"("credentialProfileId", "provider");
CREATE INDEX "ProviderCredential_credentialProfileId_idx" ON "ProviderCredential"("credentialProfileId");
CREATE INDEX "ProviderCredential_provider_status_idx" ON "ProviderCredential"("provider", "status");
CREATE UNIQUE INDEX "RegistrationCode_externalId_key" ON "RegistrationCode"("externalId");
CREATE UNIQUE INDEX "RegistrationCode_codeDigest_key" ON "RegistrationCode"("codeDigest");
CREATE INDEX "RegistrationCode_credentialProfileId_idx" ON "RegistrationCode"("credentialProfileId");
CREATE INDEX "RegistrationCode_status_expiresAt_idx" ON "RegistrationCode"("status", "expiresAt");
CREATE UNIQUE INDEX "RegistrationRedemption_userId_key" ON "RegistrationRedemption"("userId");
CREATE INDEX "RegistrationRedemption_codeId_idx" ON "RegistrationRedemption"("codeId");
CREATE UNIQUE INDEX "RegistrationPublication_externalId_key" ON "RegistrationPublication"("externalId");
CREATE UNIQUE INDEX "RegistrationPublication_version_key" ON "RegistrationPublication"("version");
CREATE INDEX "RegistrationPublication_appliedAt_idx" ON "RegistrationPublication"("appliedAt");
CREATE UNIQUE INDEX "RegistrationSyncNonce_nonce_key" ON "RegistrationSyncNonce"("nonce");
CREATE INDEX "RegistrationSyncNonce_expiresAt_idx" ON "RegistrationSyncNonce"("expiresAt");
CREATE INDEX "User_credentialProfileId_idx" ON "User"("credentialProfileId");
CREATE INDEX "User_accessStatus_idx" ON "User"("accessStatus");

-- AddForeignKey
ALTER TABLE "User"
ADD CONSTRAINT "User_credentialProfileId_fkey"
FOREIGN KEY ("credentialProfileId") REFERENCES "CredentialProfile"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProviderCredential"
ADD CONSTRAINT "ProviderCredential_credentialProfileId_fkey"
FOREIGN KEY ("credentialProfileId") REFERENCES "CredentialProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegistrationCode"
ADD CONSTRAINT "RegistrationCode_credentialProfileId_fkey"
FOREIGN KEY ("credentialProfileId") REFERENCES "CredentialProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegistrationRedemption"
ADD CONSTRAINT "RegistrationRedemption_codeId_fkey"
FOREIGN KEY ("codeId") REFERENCES "RegistrationCode"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegistrationRedemption"
ADD CONSTRAINT "RegistrationRedemption_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
