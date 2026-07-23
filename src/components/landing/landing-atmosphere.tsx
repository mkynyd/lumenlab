/**
 * 首页只保留中性画布与一处极淡的品牌蓝光源。
 * 它不随滚动运动，避免和产品叙事争夺注意力。
 */
export function LandingAtmosphere() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[var(--color-bg)]" aria-hidden="true">
      <div className="absolute left-1/2 top-[-22rem] size-[52rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-accent-soft)_0%,transparent_68%)] opacity-60" />
    </div>
  );
}
