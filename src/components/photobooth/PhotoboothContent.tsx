"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { RevealText } from "@/components/RevealText";
import { captureUrl } from "@/lib/photoboothConfig";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import { Stage } from "./Stage";
import { Countdown } from "./Countdown";
import { ShutterButton } from "./ShutterButton";
import { ReceiptPreview } from "./ReceiptPreview";

type Phase =
  | "idle"        // stream visible, shutter armed
  | "countdown"   // 5..1 running
  | "flashing"    // white flash + capturing in background
  | "preview"    // receipt overlay shown
  | "error";

export function PhotoboothContent() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uiRef = useRef<HTMLDivElement>(null);
  // Flash and capture race each other. When both finish we advance to preview.
  const flashedRef = useRef(false);
  const pendingPhotoRef = useRef<string | null>(null);

  const tryAdvanceToPreview = useCallback(() => {
    if (!flashedRef.current || !pendingPhotoRef.current) return;
    const url = pendingPhotoRef.current;
    pendingPhotoRef.current = null;
    flashedRef.current = false;
    setPhotoUrl(url);
    setPhase("preview");
  }, []);

  // Hide the chrome during countdown / flash so the moment is clean.
  useEffect(() => {
    const el = uiRef.current;
    if (!el) return;
    const hidden = phase === "countdown" || phase === "flashing" || phase === "preview";
    if (prefersReducedMotion()) {
      gsap.set(el, { autoAlpha: hidden ? 0 : 1 });
      return;
    }
    gsap.to(el, {
      autoAlpha: hidden ? 0 : 1,
      duration: hidden ? 0.3 : 0.5,
      ease: "power2.inOut",
    });
  }, [phase]);

  // Revoke the object URL when the preview closes.
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const startCountdown = useCallback(() => {
    if (phase !== "idle") return;
    setError(null);
    flashedRef.current = false;
    pendingPhotoRef.current = null;
    setPhase("countdown");
  }, [phase]);

  const onCountdownDone = useCallback(async () => {
    setPhase("flashing");
    // Kick off the actual capture during the flash. Whichever finishes last
    // gates the transition to "preview".
    try {
      const res = await fetch(captureUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error(`capture failed (${res.status})`);
      const blob = await res.blob();
      pendingPhotoRef.current = URL.createObjectURL(blob);
      tryAdvanceToPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [tryAdvanceToPreview]);

  const onFlashDone = useCallback(() => {
    flashedRef.current = true;
    tryAdvanceToPreview();
  }, [tryAdvanceToPreview]);

  const closePreview = useCallback(() => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhase("idle");
  }, [photoUrl]);

  return (
    <>
      <Stage flash={phase === "flashing"} onFlashDone={onFlashDone} />

      <Countdown active={phase === "countdown"} onDone={onCountdownDone} />

      {phase === "preview" && photoUrl && (
        <ReceiptPreview photoUrl={photoUrl} onClose={closePreview} />
      )}

      {/* Chrome — eyebrow top-left, location bottom-right, shutter bottom-center */}
      <div
        ref={uiRef}
        style={{
          position: "fixed",
          inset: 0,
          padding: "var(--page-pad)",
          pointerEvents: "none",
          color: "var(--white)",
          zIndex: 10,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
          }}
        >
          <RevealText
            as="span"
            triggerOnScroll={false}
            delay={0.2}
            style={{
              fontSize: "var(--text-sm)",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              mixBlendMode: "difference",
            }}
          >
            groupdynamics.net / photobooth
          </RevealText>
          <RevealText
            as="span"
            triggerOnScroll={false}
            delay={0.35}
            style={{
              fontSize: "var(--text-xs)",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              textAlign: "right",
              mixBlendMode: "difference",
            }}
          >
            est. 2026
          </RevealText>
        </header>

        <div />

        <footer
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "end",
            gap: "1rem",
          }}
        >
          <RevealText
            as="span"
            triggerOnScroll={false}
            delay={0.5}
            style={{
              fontSize: "var(--text-xs)",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              mixBlendMode: "difference",
            }}
          >
            salt lake city, ut 84105
          </RevealText>

          <div style={{ pointerEvents: "auto" }}>
            <ShutterButton
              onPress={startCountdown}
              disabled={phase !== "idle"}
            />
          </div>

          <RevealText
            as="span"
            triggerOnScroll={false}
            delay={0.5}
            style={{
              fontSize: "var(--text-xs)",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              textAlign: "right",
              mixBlendMode: "difference",
            }}
          >
            press to capture
          </RevealText>
        </footer>
      </div>

      {phase === "error" && error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: "var(--page-pad)",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "0.75rem 1rem",
            border: "1px solid var(--red)",
            color: "var(--red)",
            background: "var(--white)",
            fontSize: "var(--text-xs)",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            zIndex: 50,
            cursor: "pointer",
          }}
          onClick={() => {
            setError(null);
            setPhase("idle");
          }}
        >
          {error} — tap to dismiss
        </div>
      )}
    </>
  );
}
