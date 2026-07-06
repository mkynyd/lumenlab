"use client";

import { FeaturesSection } from "./features-section";
import { HeroSection } from "./hero-section";
import { HowToSection } from "./how-to-section";
import { LandingFooter } from "./landing-footer";
import { LandingNav } from "./landing-nav";

/**
 * 公开主页壳层。
 *  - 不接 SessionProvider（landing 不需要登录态）
 *  - 不渲染 (chat) 路由组的 Sidebar / Navbar
 *  - 内部子组件自行处理主题、深浅色、prefers-reduced-motion
 *
 * 主页不使用任何滚动吸附；仅保留滚动进入视口时的淡入淡出揭示动画。
 */
export function LandingSurface() {
  return (
    <div className="flex min-h-screen flex-col">
      <LandingNav />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <HowToSection />
      </main>
      <LandingFooter />
    </div>
  );
}
