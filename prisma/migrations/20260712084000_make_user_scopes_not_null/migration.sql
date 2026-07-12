-- Backfill defensively in case the preceding migration was applied by a
-- database engine or manual process that allowed NULL values.
UPDATE "User"
SET "scopes" = ARRAY['project.read', 'project.write', 'artifact.read', 'artifact.write']::TEXT[]
WHERE "scopes" IS NULL;

-- Keep the database contract aligned with the required Prisma `String[]`.
ALTER TABLE "User" ALTER COLUMN "scopes" SET NOT NULL;
