-- Deep Research Claim Graph v1：Claim 幂等键。
-- claimKey 为可空列，历史 Claim、Follow-up 继承 Claim 与用户手工编辑保持 NULL；
-- Claim Extractor 生成的 system Claim 写入 deterministic key
--（extractor 版本 + Question key + 模型语义 key 归一化），配合 (runId, claimKey)
-- 唯一约束保证 durable retry / lease 恢复 / 相同 Evidence fingerprint 重跑不重复建 Claim。
-- PostgreSQL 唯一索引允许多个 NULL，既有数据无需回填，可安全 migrate deploy。
ALTER TABLE "Claim" ADD COLUMN "claimKey" TEXT;

CREATE UNIQUE INDEX "Claim_runId_claimKey_key" ON "Claim"("runId", "claimKey");
