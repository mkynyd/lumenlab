"use client";

import Image from "next/image";
import Link from "next/link";
import { AuthShowcase } from "@/components/auth/auth-showcase";
import { ThemeToggle } from "@/components/ui/theme-toggle";

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="min-h-dvh bg-[var(--color-bg)] p-3 sm:p-4">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[96rem] lg:grid-cols-[minmax(31rem,0.92fr)_minmax(0,1.08fr)] sm:min-h-[calc(100dvh-2rem)]">
        <section className="flex min-w-0 flex-col px-3 py-3 sm:px-7 sm:py-6 xl:px-12 xl:py-9">
          <header className="flex items-center justify-between gap-4">
            <Link
              href="/home"
              className="flex items-center gap-3 rounded-[var(--radius-md)] py-1 pr-2 text-base font-semibold tracking-[-0.015em] text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent)]"
            >
              <Image
                src="/LumenLab.png"
                alt=""
                width={36}
                height={36}
                priority
                className="size-9 rounded-[var(--radius-md)]"
              />
              <span>LumenLab</span>
            </Link>
            <ThemeToggle />
          </header>

          <main className="flex flex-1 items-center py-10 sm:py-14">
            <div className="mx-auto w-full max-w-[31rem] motion-safe:animate-slide-up-fade">
              <div className="mb-8">
                <h1 className="text-balance text-[2rem] font-semibold leading-tight tracking-[-0.025em] text-[var(--color-text-primary)] sm:text-[2.25rem]">
                  {title}
                </h1>
                <p className="mt-3 max-w-[42ch] text-[15px] leading-6 text-[var(--color-text-secondary)]">
                  {subtitle}
                </p>
              </div>

              {children}

              <div className="mt-8 text-sm text-[var(--color-text-secondary)]">
                {footer}
              </div>
            </div>
          </main>
        </section>

        <AuthShowcase />
      </div>
    </div>
  );
}
