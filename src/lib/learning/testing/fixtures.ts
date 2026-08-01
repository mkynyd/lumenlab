import type {
  LearningClock,
  LearningIdGenerator,
  LearningModelGateway,
} from "@/lib/learning/contracts";

export function createFixedLearningClock(
  value = "2026-07-31T00:00:00.000Z"
): LearningClock {
  const fixed = new Date(value);
  return {
    now: () => new Date(fixed.getTime()),
  };
}

export function createSequentialLearningIds(
  seed = 0
): LearningIdGenerator {
  let sequence = seed;
  return {
    nextId(kind: string) {
      sequence += 1;
      return `${kind}-${sequence}`;
    },
  };
}

export function createFixtureLearningModel(
  responses: {
    knowledgeMap?: unknown;
    practiceItems?: unknown;
    evaluation?: unknown;
    studyPackSection?: unknown;
  } = {}
): LearningModelGateway {
  return {
    async generateKnowledgeMap() {
      return responses.knowledgeMap ?? { points: [] };
    },
    async generatePracticeItems() {
      return responses.practiceItems ?? [];
    },
    async evaluateAttempt() {
      return (
        responses.evaluation ?? {
          verdict: "uncertain",
          score: null,
          rubric: null,
          confidence: 0,
          errorType: null,
          reason: "No fixture evaluation was configured.",
        }
      );
    },
    async generateStudyPackSection() {
      return (
        responses.studyPackSection ?? {
          content: "# 复习章节\n\n## 核心要点\n- 示例要点",
        }
      );
    },
  };
}
