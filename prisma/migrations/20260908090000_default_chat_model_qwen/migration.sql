-- New rows only. Preserve all existing model choices and usage records.
ALTER TABLE "Conversation" ALTER COLUMN "model" SET DEFAULT 'qwen3.8-flash';
ALTER TABLE "Project" ALTER COLUMN "defaultModel" SET DEFAULT 'qwen3.8-flash';
