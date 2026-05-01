"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";

interface ShutterButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

/**
 * Circular shutter button — outline ring with a small red dot inside (the
 * one accent on the page). Hover is opacity-only per the design rules.
 */
export function ShutterButton({ onPress, disabled }: ShutterButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    gsap.from(el, {
      opacity: 0,
      y: 16,
      duration: 0.8,
      ease: "power3.out",
      delay: 0.4,
    });
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label="Take photo"
      className="hover:opacity-50 transition-opacity"
      style={{
        appearance: "none",
        border: "1px solid var(--white)",
        background: "transparent",
        borderRadius: "9999px",
        width: "clamp(72px, 8vw, 96px)",
        height: "clamp(72px, 8vw, 96px)",
        display: "grid",
        placeItems: "center",
        cursor: disabled ? "default" : "pointer",
        padding: 0,
      }}
    >
      <span
        style={{
          width: "55%",
          height: "55%",
          borderRadius: "9999px",
          background: "var(--red)",
        }}
      />
    </button>
  );
}
