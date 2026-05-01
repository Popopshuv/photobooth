"use client";

import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useTransitionStore } from "@/store/useTransitionStore";

export function PageReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const unsubscribe = useTransitionStore.subscribe((state, prev) => {
      if (state.phase === "exiting" && prev.phase !== "exiting") {
        gsap.to(el, {
          opacity: 0,
          duration: 0.3,
          ease: "power2.in",
          onComplete: () => gsap.set(el, { opacity: 0 }),
        });
      } else if (state.phase === "navigating" && prev.phase === "exiting") {
        // Lock to 0 across the React commit so the new page doesn't peek through.
        gsap.killTweensOf(el);
        gsap.set(el, { opacity: 0 });
      } else if (state.phase === "revealing" && prev.phase !== "revealing") {
        gsap.to(el, { opacity: 1, duration: 0.6, ease: "power2.out" });
      }
    });

    return unsubscribe;
  }, []);

  // First load: no intro — page is visible immediately.
  return <div ref={ref}>{children}</div>;
}
