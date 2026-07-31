-- DeepSeek's official V4 Flash lane is the default fast/light model.
-- Existing projects and conversations keep their explicitly selected model.
ALTER TABLE "Conversation" ALTER COLUMN "model" SET DEFAULT 'deepseek-v4-flash';
ALTER TABLE "Project" ALTER COLUMN "defaultModel" SET DEFAULT 'deepseek-v4-flash';
