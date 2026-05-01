"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTransitionStore } from "@/store/useTransitionStore";

export function TransitionController() {
  const router = useRouter();
  const pathname = usePathname();
  const hasNavigated = useRef(false);

  useEffect(() => {
    const unsubscribe = useTransitionStore.subscribe((state, prev) => {
      if (state.phase === "navigating" && prev.phase === "exiting") {
        if (state.targetPath && !hasNavigated.current) {
          hasNavigated.current = true;
          router.push(state.targetPath);
        }
      }
    });

    return unsubscribe;
  }, [router]);

  // Drive entering/revealing off the actual pathname commit, not wall-clock.
  // React concurrent rendering defers the DOM swap after router.push, so
  // setTimeout-based phase changes can fade in the old page's content.
  useEffect(() => {
    const state = useTransitionStore.getState();
    if (state.phase !== "navigating" || pathname !== state.targetPath) return;

    state.setPhase("entering");
    const t1 = setTimeout(() => {
      useTransitionStore.getState().setPhase("revealing");
    }, 700);
    const t2 = setTimeout(() => {
      useTransitionStore.getState().completeTransition();
      hasNavigated.current = false;
    }, 1300);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [pathname]);

  return null;
}
