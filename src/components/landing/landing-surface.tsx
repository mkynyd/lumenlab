"use client";

import { FeaturesSection } from "./features-section";
import { HeroSection } from "./hero-section";
import { HowToSection } from "./how-to-section";
import { LandingFooter } from "./landing-footer";
import { LandingNav } from "./landing-nav";
import { LandingAtmosphere } from "./landing-atmosphere";

/**
 * 公开主页壳层。
 *  - 不接 SessionProvider（landing 不需要登录态）
 *  - 不渲染 (chat) 路由组的 Sidebar / Navbar
 *  - 产品叙事在桌面使用 ScrollTrigger，移动端退化为原生横向 snap
 */
export function LandingSurface() {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-[var(--color-bg)]">
      <LandingAtmosphere />
      <div className="relative z-10 flex min-h-screen flex-col">
        <LandingNav />
        <main className="flex-1">
          <HeroSection />
          <FeaturesSection />
          <HowToSection />
        </main>
        <LandingFooter />
      </div>
    </div>
  );
}
