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
        // Two rings — white outer, thin dark inner — so the button stays
        // legible whether the camera is pointed at a bright or dark scene.
        border: "1px solid var(--white)",
        boxShadow: "inset 0 0 0 1px rgba(26,26,26,0.55)",
        background: "rgba(26,26,26,0.18)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
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
