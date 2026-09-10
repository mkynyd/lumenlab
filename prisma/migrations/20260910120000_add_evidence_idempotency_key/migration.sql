-- Deep Research Evidence Pipeline v1：Evidence 幂等键。
-- evidenceKey 为可空列，历史 Evidence 与用户手工 revision 保持 NULL；
-- 系统来源 Evidence 写入 deterministic hash，配合 (runId, evidenceKey) 唯一约束
-- 保证 durable task 重跑 / lease 恢复 / 同一 chunk 重复发现时不产生重复 Evidence。
-- PostgreSQL 唯一索引允许多个 NULL，既有数据无需回填，可安全 migrate deploy。
ALTER TABLE "Evidence" ADD COLUMN "evidenceKey" TEXT;

CREATE UNIQUE INDEX "Evidence_runId_evidenceKey_key" ON "Evidence"("runId", "evidenceKey");
