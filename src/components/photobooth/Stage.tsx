"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { streamUrl } from "@/lib/photoboothConfig";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";

interface StageProps {
  /** When true, a brief white flash plays once. */
  flash: boolean;
  onFlashDone?: () => void;
}

/**
 * Full-bleed live MJPEG view of the Pi camera. The shutter flash is layered
 * on top (kept in this component so the flash sits behind the UI overlay but
 * above the stream).
 */
export function Stage({ flash, onFlashDone }: StageProps) {
  const flashRef = useRef<HTMLDivElement>(null);
  const [streamFailed, setStreamFailed] = useState(false);
  // The stream URL depends on `window.location` so it must be resolved on the
  // client. Stay null during SSR / first render to avoid hydration mismatch.
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // setSrc-in-effect is the correct pattern here — the value depends on
    // `window.location` which doesn't exist during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSrc(streamUrl());
  }, []);

  useEffect(() => {
    if (!flash) return;
    const el = flashRef.current;
    if (!el) return;

    if (prefersReducedMotion()) {
      onFlashDone?.();
      return;
    }

    const tl = gsap.timeline({ onComplete: () => onFlashDone?.() });
    tl.set(el, { opacity: 0, display: "block" })
      .to(el, { opacity: 1, duration: 0.05, ease: "power2.out" })
      .to(el, { opacity: 0, duration: 0.6, ease: "power2.inOut" })
      .set(el, { display: "none" });
  }, [flash, onFlashDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--black)",
        overflow: "hidden",
        zIndex: 0,
      }}
    >
      {src && !streamFailed && (
        // next/image can't consume an MJPEG multipart stream, so a raw <img> is required here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          onError={() => setStreamFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // Mirror horizontally so the preview behaves like a mirror —
            // raise your right hand, see it rise on the right side of the
            // screen. Captured stills are mirrored server-side to match.
            transform: "scaleX(-1)",
          }}
        />
      )}
      {streamFailed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "var(--gray-3)",
            fontSize: "var(--text-sm)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            padding: "var(--page-pad)",
            textAlign: "center",
          }}
        >
          camera offline — check pi server at {src}
        </div>
      )}

      <div
        ref={flashRef}
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--white)",
          opacity: 0,
          display: "none",
          pointerEvents: "none",
          zIndex: 5,
        }}
      />
    </div>
  );
}
