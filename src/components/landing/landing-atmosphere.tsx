"use client";

import { cubicBezier, motion, useScroll, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "./prefers-motion";

const EASE_OUT = cubicBezier(0.22, 1, 0.36, 1);
const EASE_IN = cubicBezier(0.65, 0, 0.35, 1);

/**
 * Fixed, page-level atmosphere for the landing surface.
 *
 * Individual sections stay transparent so the canvas never drops back to a
 * flat background between scenes. The layers only cross-fade as the reader
 * scrolls; there is no autonomous loop competing with the content.
 */
export function LandingAtmosphere() {
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll();

  const heroOpacity = useTransform(
    scrollYProgress,
    [0, 0.12, 0.28],
    [1, 1, 0],
    { ease: [EASE_OUT, EASE_IN] }
  );
  const workbenchOpacity = useTransform(
    scrollYProgress,
    [0.1, 0.27, 0.5, 0.66],
    [0, 1, 1, 0],
    { ease: [EASE_OUT, EASE_OUT, EASE_IN] }
  );
  const guideOpacity = useTransform(
    scrollYProgress,
    [0.42, 0.58, 0.78, 0.94],
    [0, 1, 1, 0.35],
    { ease: [EASE_OUT, EASE_OUT, EASE_IN] }
  );
  const finaleOpacity = useTransform(
    scrollYProgress,
    [0.7, 0.88, 1],
    [0, 1, 1],
    { ease: [EASE_OUT, EASE_OUT] }
  );

  return (
    <div className="landing-atmosphere" aria-hidden="true">
      {reduced ? (
        <div className="landing-atmosphere-layer landing-atmosphere-layer--static" />
      ) : (
        <>
          <motion.div
            className="landing-atmosphere-layer landing-atmosphere-layer--hero"
            style={{ opacity: heroOpacity }}
          />
          <motion.div
            className="landing-atmosphere-layer landing-atmosphere-layer--workbench"
            style={{ opacity: workbenchOpacity }}
          />
          <motion.div
            className="landing-atmosphere-layer landing-atmosphere-layer--guide"
            style={{ opacity: guideOpacity }}
          />
          <motion.div
            className="landing-atmosphere-layer landing-atmosphere-layer--finale"
            style={{ opacity: finaleOpacity }}
          />
        </>
      )}
    </div>
  );
}
