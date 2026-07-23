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
 *  - 内部子组件自行处理主题、深浅色、prefers-reduced-motion
 *
 * 主页不使用滚动吸附。背景和场景的过渡由滚动位置连续驱动，
 * 让内容在进入、停留、离开时保持清晰的叙事节奏。
 */
export function LandingSurface() {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-x-clip">
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
