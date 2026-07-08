import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AmbientField } from "@/components/workbench/ambient-field";

export const metadata = {
  title: "页面未找到 · LumenLab",
};

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
      <AmbientField
        intensity="medium"
        density="wide"
        className="absolute inset-0 -z-10"
      />

      <main className="relative z-0 w-full max-w-sm text-center">
        <div data-dot-avoid className="mb-8">
          <p className="text-sm font-medium text-[var(--color-accent)]">404</p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            页面未找到
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            你访问的页面不存在或已被移除。
          </p>
        </div>

        <div
          data-dot-avoid
          className="motion-safe:animate-slide-up-fade rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-6"
        >
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
            返回首页继续探索 LumenLab，或进入对话页开始新的研究。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="primary" className="flex-1 rounded-[var(--radius-md)]">
              <Link href="/chat">进入对话</Link>
            </Button>
            <Button asChild variant="outline" className="flex-1 rounded-[var(--radius-md)]">
              <Link href="/home">返回首页</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
