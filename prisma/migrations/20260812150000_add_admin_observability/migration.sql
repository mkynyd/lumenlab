CREATE TABLE "AdminObservabilityNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminObservabilityNonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminObservabilityAudit" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminObservabilityAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminObservabilityNonce_nonce_key" ON "AdminObservabilityNonce"("nonce");
CREATE INDEX "AdminObservabilityNonce_expiresAt_idx" ON "AdminObservabilityNonce"("expiresAt");
CREATE INDEX "AdminObservabilityAudit_createdAt_idx" ON "AdminObservabilityAudit"("createdAt");
CREATE INDEX "AdminObservabilityAudit_action_createdAt_idx" ON "AdminObservabilityAudit"("action", "createdAt");
