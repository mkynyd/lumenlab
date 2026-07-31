import { LearningPageClient } from "@/components/learning/learning-page-client";
import { LearningUnavailable } from "@/components/learning/learning-unavailable";
import { resolveLearningPageFlags } from "@/components/learning/rollout";
import {
  LEARNING_DEEP_LINK_STEPS,
  type LearningDeepLinkStep,
} from "@/lib/hooks/use-learning-api";

export const dynamic = "force-dynamic";

/** Entity ids are server-generated slugs; reject anything path-like. */
const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const LEARNING_STEPS = new Set<string>(LEARNING_DEEP_LINK_STEPS);

interface ProjectLearningPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    goal?: string | string[];
    step?: string | string[];
    session?: string | string[];
  }>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProjectLearningPage({
  params,
  searchParams,
}: ProjectLearningPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const goal = firstParam(query.goal);
  const step = firstParam(query.step);
  const session = firstParam(query.session);
  const flags = resolveLearningPageFlags();
  if (!flags.available) {
    return <LearningUnavailable />;
  }
  const initialSessionId =
    session && ENTITY_ID_PATTERN.test(session) ? session : null;
  const initialGoalId =
    goal && ENTITY_ID_PATTERN.test(goal) ? goal : null;
  const initialStep =
    step && LEARNING_STEPS.has(step) ? (step as LearningDeepLinkStep) : null;
  return (
    <LearningPageClient
      key={`${initialGoalId ?? "active"}:${initialStep ?? "progress"}:${initialSessionId ?? "browse"}`}
      projectId={id}
      initialGoalId={initialGoalId}
      initialStep={initialStep}
      initialSessionId={initialSessionId}
      rollout={flags.rollout}
    />
  );
}
