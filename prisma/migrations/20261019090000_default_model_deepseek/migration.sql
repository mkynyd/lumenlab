-- Change defaults only; preserve saved choices, messages and settled usage.
ALTER TABLE "Conversation" ALTER COLUMN "model" SET DEFAULT 'deepseek-flash';
ALTER TABLE "Project" ALTER COLUMN "defaultModel" SET DEFAULT 'deepseek-flash';
