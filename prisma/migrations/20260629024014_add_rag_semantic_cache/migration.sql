-- CreateTable
CREATE TABLE "QueryEmbeddingCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueryEmbeddingCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticResponseCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "responseType" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SemanticResponseCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueryEmbeddingCache_userId_idx" ON "QueryEmbeddingCache"("userId");

-- CreateIndex
CREATE INDEX "QueryEmbeddingCache_namespace_idx" ON "QueryEmbeddingCache"("namespace");

-- CreateIndex
CREATE INDEX "QueryEmbeddingCache_expiresAt_idx" ON "QueryEmbeddingCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueryEmbeddingCache_namespace_promptHash_key" ON "QueryEmbeddingCache"("namespace", "promptHash");

-- CreateIndex
CREATE INDEX "SemanticResponseCache_userId_idx" ON "SemanticResponseCache"("userId");

-- CreateIndex
CREATE INDEX "SemanticResponseCache_namespace_idx" ON "SemanticResponseCache"("namespace");

-- CreateIndex
CREATE INDEX "SemanticResponseCache_responseType_idx" ON "SemanticResponseCache"("responseType");

-- CreateIndex
CREATE INDEX "SemanticResponseCache_expiresAt_idx" ON "SemanticResponseCache"("expiresAt");
