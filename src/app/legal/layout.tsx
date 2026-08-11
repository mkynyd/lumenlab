import Link from "next/link";
import type { ReactNode } from "react";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-panel-muted)]">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-[var(--color-text-primary)]"
          >
            LumenLab
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/legal/terms"
              className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              用户协议
            </Link>
            <Link
              href="/legal/privacy"
              className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              隐私政策
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
