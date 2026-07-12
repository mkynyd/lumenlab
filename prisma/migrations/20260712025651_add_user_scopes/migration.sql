-- AlterTable
ALTER TABLE "User" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['project.read', 'project.write', 'artifact.read', 'artifact.write']::TEXT[];
