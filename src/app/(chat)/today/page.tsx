import { LearningUnavailable } from "@/components/learning/learning-unavailable";
import { resolveLearningPageFlags } from "@/components/learning/rollout";
import { TodayView } from "@/components/learning/today-view";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  const flags = resolveLearningPageFlags();
  if (!flags.available) {
    return <LearningUnavailable />;
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:py-8">
        <header className="mb-6">
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            今天
          </h1>
          {flags.rollout === "preview" ? (
            <p className="text-xs text-[var(--color-text-tertiary)]">
              学习功能预览版
            </p>
          ) : null}
        </header>
        <TodayView />
      </div>
    </div>
  );
}
