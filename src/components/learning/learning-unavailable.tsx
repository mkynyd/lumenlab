import { EmptyState } from "@/components/learning/empty-state";

export function LearningUnavailable() {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <EmptyState
        title="学习功能当前未开放"
        description="学习闭环正在小范围内测，敬请期待。"
      />
    </div>
  );
}
