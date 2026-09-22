"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const ProductStory = dynamic(() => import("./product-story").then((m) => m.ProductStory));

export function FeaturesSection() {
  const sentinel = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || nearViewport) return;
    if (!window.IntersectionObserver) {
      const frame = requestAnimationFrame(() => setNearViewport(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "250px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [nearViewport]);

  return (
    <div id="features" ref={sentinel} className="scroll-mt-14">
      {nearViewport ? <ProductStory /> : <div aria-hidden="true" className="min-h-[100svh] lg:min-h-[600svh]" />}
    </div>
  );
}
