"use client";

import { RefObject, useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTransitionStore } from "@/store/useTransitionStore";
import { prefersReducedMotion } from "./prefersReducedMotion";

gsap.registerPlugin(ScrollTrigger);

export type RevealPreset =
  | "fade"
  | "fade-up"
  | "lift"
  | "mask"
  | "scale";

type CustomHandler = (el: HTMLElement) => void;

interface UseRevealOptions {
  /** ScrollTrigger position. Default `"top 85%"`. */
  start?: string;
  /** Fire once vs every entry. Default `true`. */
  once?: boolean;
  /** Set `false` to fire on mount instead of on scroll. Default `true`. */
  triggerOnScroll?: boolean;
  /** Delay before the tween starts. */
  delay?: number;
  /** Duration override. Each preset has a tasteful default. */
  duration?: number;
}

interface PresetContext {
  delay: number;
  duration: number | undefined;
}

const PRESETS: Record<RevealPreset, (el: HTMLElement, ctx: PresetContext) => void> = {
  fade: (el, { delay, duration }) => {
    gsap.from(el, {
      opacity: 0,
      duration: duration ?? 0.6,
      ease: "power2.out",
      delay,
    });
  },
  "fade-up": (el, { delay, duration }) => {
    gsap.from(el, {
      opacity: 0,
      y: 20,
      duration: duration ?? 0.8,
      ease: "power3.out",
      delay,
    });
  },
  lift: (el, { delay, duration }) => {
    gsap.from(el, {
      opacity: 0,
      y: 40,
      duration: duration ?? 1,
      ease: "power3.out",
      delay,
    });
  },
  mask: (el, { delay, duration }) => {
    gsap.fromTo(
      el,
      { clipPath: "inset(0 100% 0 0)" },
      {
        clipPath: "inset(0 0% 0 0)",
        duration: duration ?? 0.6,
        ease: "power3.inOut",
        delay,
      },
    );
  },
  scale: (el, { delay, duration }) => {
    gsap.from(el, {
      opacity: 0,
      scale: 0.96,
      transformOrigin: "center center",
      duration: duration ?? 0.8,
      ease: "power3.out",
      delay,
    });
  },
};

/**
 * Reveal a non-text element on scroll using one of the system presets, or a
 * custom callback for one-offs. Handles three things you'd otherwise rewrite:
 *
 * 1. Gates on the page-transition phase so reveals don't fire while the page
 *    is fading out / swapping.
 * 2. Sets up a one-shot `ScrollTrigger` (default `"top 85%"`).
 * 3. Snaps reduced-motion users to the end state and skips the tween.
 *
 * @example
 * useReveal(ref, "fade-up");
 * useReveal(ref, "mask", { delay: 0.2 });
 * useReveal(ref, (el) => gsap.from(el, { ... }));
 */
export function useReveal<T extends HTMLElement>(
  ref: RefObject<T | null>,
  animation: RevealPreset | CustomHandler,
  options: UseRevealOptions = {},
) {
  const {
    start = "top 85%",
    once = true,
    triggerOnScroll = true,
    delay = 0,
    duration,
  } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const run = () => {
      if (prefersReducedMotion()) return;
      if (typeof animation === "function") {
        animation(el);
      } else {
        PRESETS[animation](el, { delay, duration });
      }
    };

    const setupTrigger = () => {
      if (!triggerOnScroll) {
        run();
        return;
      }
      ScrollTrigger.create({ trigger: el, start, once, onEnter: run });
    };

    const cleanupTriggers = () => {
      ScrollTrigger.getAll().forEach((t) => {
        if (t.trigger === el) t.kill();
      });
    };

    const isReady = (s: ReturnType<typeof useTransitionStore.getState>) =>
      s.phase === "idle" || s.phase === "revealing";

    let unsub: (() => void) | undefined;
    if (isReady(useTransitionStore.getState())) {
      setupTrigger();
    } else {
      unsub = useTransitionStore.subscribe((state) => {
        if (isReady(state)) {
          unsub?.();
          setupTrigger();
        }
      });
    }

    return () => {
      unsub?.();
      cleanupTriggers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation, start, once, triggerOnScroll, delay, duration]);
}
