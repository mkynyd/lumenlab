import { normalizeTaskLimit, type TaskSnapshot, type TaskSource } from "./contracts";
import { AgentExecutionTaskSource } from "./agent-execution-source";

/**
 * 任务源注册表。main 只注册 AgentExecution；任务 11 在 feature 分支接入
 * Paper 编译任务时新增一个 source，不改动本文件之外的合同。
 */
const TASK_SOURCES: readonly TaskSource[] = [new AgentExecutionTaskSource()];

export function getTaskSource(taskType: string): TaskSource | undefined {
  return TASK_SOURCES.find((source) => source.taskType === taskType);
}

export function listTaskSources(): readonly TaskSource[] {
  return TASK_SOURCES;
}

/** 汇总所有任务源的进行中任务，按更新时间倒序。 */
export async function listActiveTasks(input: {
  userId: string;
  limit?: number;
}): Promise<TaskSnapshot[]> {
  const limit = normalizeTaskLimit(input.limit);
  const groups = await Promise.all(
    TASK_SOURCES.map((source) => source.listActive({ ...input, limit }))
  );
  return groups
    .flat()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}
