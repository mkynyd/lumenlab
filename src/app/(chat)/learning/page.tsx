import { LearningUnavailable } from "@/components/learning/learning-unavailable"
import { resolveLearningPageFlags } from "@/components/learning/rollout"
import { LearningWorkspace } from "@/components/learning/learning-workspace"
import {
  LEARNING_DEEP_LINK_STEPS,
  type LearningDeepLinkStep,
} from "@/lib/hooks/use-learning-api"

export const dynamic = "force-dynamic"

const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/
const LEARNING_STEPS = new Set<string>(LEARNING_DEEP_LINK_STEPS)

interface LearningPageProps {
  searchParams: Promise<{
    project?: string | string[]
    goal?: string | string[]
    step?: string | string[]
    session?: string | string[]
  }>
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function LearningPage({ searchParams }: LearningPageProps) {
  const query = await searchParams
  const project = firstParam(query.project)
  const goal = firstParam(query.goal)
  const step = firstParam(query.step)
  const session = firstParam(query.session)
  const flags = resolveLearningPageFlags()

  if (!flags.available) {
    return <LearningUnavailable />
  }

  const initialProjectId =
    project && ENTITY_ID_PATTERN.test(project) ? project : null
  const initialGoalId =
    initialProjectId && goal && ENTITY_ID_PATTERN.test(goal) ? goal : null
  const initialSessionId =
    initialProjectId && session && ENTITY_ID_PATTERN.test(session) ? session : null
  const initialStep =
    initialProjectId && step && LEARNING_STEPS.has(step)
      ? (step as LearningDeepLinkStep)
      : null

  return (
    <LearningWorkspace
      key={`${initialProjectId ?? "overview"}:${initialGoalId ?? "active"}:${initialStep ?? "progress"}:${initialSessionId ?? "browse"}`}
      initialProjectId={initialProjectId}
      initialGoalId={initialGoalId}
      initialStep={initialStep}
      initialSessionId={initialSessionId}
      rollout={flags.rollout}
    />
  )
}
