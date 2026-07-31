import { redirect } from "next/navigation";
import {
  LEARNING_DEEP_LINK_STEPS,
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
  const destination = new URLSearchParams();
  if (ENTITY_ID_PATTERN.test(id)) destination.set("project", id);
  if (goal && ENTITY_ID_PATTERN.test(goal)) destination.set("goal", goal);
  if (step && LEARNING_STEPS.has(step)) destination.set("step", step);
  if (session && ENTITY_ID_PATTERN.test(session)) destination.set("session", session);
  redirect(`/learning${destination.size > 0 ? `?${destination.toString()}` : ""}`);
}
