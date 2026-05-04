"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";

interface CountdownProps {
  /** When set, runs a 4→1 countdown then calls `onDone`. */
  active: boolean;
  onDone: () => void;
}

const DIGITS = ["4", "3", "2", "1"];

/**
 * Big centred 4-3-2-1 countdown. Each digit masks in, settles, then masks
 * out — the final mask-out triggers the next digit so timing is exact.
 */
export function Countdown({ active, onDone }: CountdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const digitRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    const digit = digitRef.current;
    if (!root || !digit) return;

    if (prefersReducedMotion()) {
      const t = window.setTimeout(onDone, 500);
      return () => window.clearTimeout(t);
    }

    const tl = gsap.timeline({ onComplete: onDone });
    tl.set(root, { autoAlpha: 1 });

    DIGITS.forEach((d, i) => {
      tl.call(() => {
        digit.textContent = d;
      });
      tl.fromTo(
        digit,
        { y: 24, opacity: 0, scale: 0.96 },
        { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: "power3.out" },
        i === 0 ? "+=0" : "<",
      );
      tl.to(digit, { opacity: 0, y: -16, duration: 0.3, ease: "power2.in" }, "+=0.55");
    });

    tl.to(root, { autoAlpha: 0, duration: 0.2, ease: "power2.out" }, "+=0");

    return () => {
      tl.kill();
    };
  }, [active, onDone]);

  return (
    <div
      ref={rootRef}
      aria-hidden={!active}
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
        opacity: 0,
        visibility: "hidden",
        zIndex: 20,
      }}
    >
      <span
        ref={digitRef}
        style={{
          fontFamily: "var(--font-abc)",
          fontSize: "clamp(8rem, 28vw, 22rem)",
          color: "var(--white)",
          letterSpacing: "0.05em",
          lineHeight: 1,
          textShadow: "0 0 40px rgba(0,0,0,0.45)",
          fontWeight: 300,
        }}
      />
    </div>
  );
}
