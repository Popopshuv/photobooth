"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";

interface SpinnerProps {
  /** Diameter in pixels. */
  size?: number;
  /** Stroke colour. Any CSS colour or `var(--token)`. */
  color?: string;
  /** Stroke thickness. Keep light to match the design language. */
  strokeWidth?: number;
}

/**
 * Continuous-rotation arc spinner. Driven by GSAP (CSS keyframes are banned
 * by the design system) so reduced-motion users see a static ring instead.
 */
export function Spinner({
  size = 28,
  color = "currentColor",
  strokeWidth = 1.5,
}: SpinnerProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    const tween = gsap.to(el, {
      rotation: 360,
      duration: 1.2,
      ease: "none",
      repeat: -1,
      transformOrigin: "50% 50%",
    });
    return () => {
      tween.kill();
    };
  }, []);

  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  // ~25% of the ring is visible at any time.
  const arc = circumference * 0.25;

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${arc} ${circumference - arc}`}
        strokeLinecap="butt"
      />
    </svg>
  );
}
