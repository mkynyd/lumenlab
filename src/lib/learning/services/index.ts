import "server-only";

import { randomUUID } from "node:crypto";

import {
  systemLearningClock,
} from "@/lib/learning/contracts";
import { prisma } from "@/lib/db";
import { createLearningService } from "./learning-service";
import { deepSeekLearningModelGateway } from "@/lib/learning/model-gateway";

export const learningService = createLearningService({
  prisma,
  clock: systemLearningClock,
  ids: {
    nextId: (kind) => `${kind}-${randomUUID()}`,
  },
  modelGateway: deepSeekLearningModelGateway,
});

export function recordFileContentChange(input: {
  userId: string;
  fileAssetId: string;
  previousFingerprint: string;
  currentFingerprint: string;
}) {
  return learningService.recordFileContentChange(input);
}

export function recordFileDeletion(input: {
  userId: string;
  fileAssetId: string;
  previousFingerprint: string;
}) {
  return learningService.recordFileDeletion(input);
}

export { createLearningService };
export type { LearningService } from "./learning-service";
