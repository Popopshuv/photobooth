"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { RevealText } from "@/components/RevealText";
import { Spinner } from "@/components/Spinner";
import { captureUrl, printUrl, RECEIPT } from "@/lib/photoboothConfig";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import { Stage } from "./Stage";
import { Countdown } from "./Countdown";

type Phase =
  | "idle"        // stream visible, shutter armed
  | "countdown"   // 4..1 running
  | "flashing"    // white flash + capturing in background
  | "printing"    // composing receipt + sending to printer
  | "printed"     // brief confirmation before resetting
  | "error";

const PRINTED_HOLD_MS = 1400;

export function PhotoboothContent() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Which photo of the strip we're currently working on (1-indexed for the
  // user-facing chrome, 0-based internally). Drives the "1/4" indicator.
  const [photoIndex, setPhotoIndex] = useState(0);

  const uiRef = useRef<HTMLDivElement>(null);
  // Flash and capture race each other. When both finish we either kick
  // off the next photo's countdown or, on the last photo, the print.
  const flashedRef = useRef(false);
  const pendingPhotoRef = useRef<string | null>(null);
  // Photos accumulated this session — sent together to /print at the end.
  const photoStripRef = useRef<string[]>([]);

  const composeAndPrint = useCallback(async (photoUrls: string[]) => {
    try {
      // Multipart with one `photos` entry per photo. The server stacks
      // them into a vertical strip and prints as a single bitmap.
      const form = new FormData();
      for (const url of photoUrls) {
        const blob = await (await fetch(url)).blob();
        form.append("photos", blob);
      }
      form.append("brand", RECEIPT.brand);
      form.append("lines", JSON.stringify(RECEIPT.lines));
      form.append("feed_lines", String(RECEIPT.feedLines));

      const res = await fetch(printUrl(), { method: "POST", body: form });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `print failed (${res.status})`);
      }

      photoUrls.forEach((u) => URL.revokeObjectURL(u));
      setPhase("printed");
      window.setTimeout(() => setPhase("idle"), PRINTED_HOLD_MS);
    } catch (e) {
      photoUrls.forEach((u) => URL.revokeObjectURL(u));
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  const tryAdvanceAfterCapture = useCallback(() => {
    if (!flashedRef.current || !pendingPhotoRef.current) return;
    const url = pendingPhotoRef.current;
    pendingPhotoRef.current = null;
    flashedRef.current = false;

    photoStripRef.current.push(url);
    const captured = photoStripRef.current.length;

    if (captured >= RECEIPT.photoCount) {
      // Last photo — send the whole strip to print.
      setPhase("printing");
      composeAndPrint([...photoStripRef.current]);
      photoStripRef.current = [];
    } else {
      // More to go — small breathing pause, then re-arm the countdown.
      setPhotoIndex(captured);
      window.setTimeout(() => setPhase("countdown"), RECEIPT.betweenPhotosMs);
    }
  }, [composeAndPrint]);

  // Hide the chrome any time the moment isn't "ready to capture".
  useEffect(() => {
    const el = uiRef.current;
    if (!el) return;
    const hidden = phase !== "idle" && phase !== "error";
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

  const startCountdown = useCallback(() => {
    if (phase !== "idle") return;
    setError(null);
    flashedRef.current = false;
    pendingPhotoRef.current = null;
    photoStripRef.current = [];
    setPhotoIndex(0);
    setPhase("countdown");
  }, [phase]);

  const onCountdownDone = useCallback(async () => {
    setPhase("flashing");
    try {
      const res = await fetch(captureUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error(`capture failed (${res.status})`);
      const blob = await res.blob();
      pendingPhotoRef.current = URL.createObjectURL(blob);
      tryAdvanceAfterCapture();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [tryAdvanceAfterCapture]);

  const onFlashDone = useCallback(() => {
    flashedRef.current = true;
    tryAdvanceAfterCapture();
  }, [tryAdvanceAfterCapture]);

  // Live count of which photo we're on, for the 1/4 indicator. After
  // each capture `photoIndex` is the count of completed shots.
  const totalPhotos = RECEIPT.photoCount;
  const currentShot = Math.min(totalPhotos, photoIndex + 1);

  return (
    <>
      <Stage flash={phase === "flashing"} onFlashDone={onFlashDone} />

      <Countdown active={phase === "countdown"} onDone={onCountdownDone} />

      {/* Full-viewport tap target while idle — anywhere on screen starts
          the session. Sits above the stream but below the chrome so
          existing labelled controls still receive their own clicks. */}
      {phase === "idle" && (
        <button
          type="button"
          onClick={startCountdown}
          aria-label="Take photos"
          style={{
            position: "fixed",
            inset: 0,
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            zIndex: 5,
          }}
        />
      )}

      {(phase === "printing" || phase === "printed") && (
        <PrintOverlay phase={phase} />
      )}

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
            {phase === "countdown" || phase === "flashing"
              ? `${currentShot} / ${totalPhotos}`
              : "est. 2026"}
          </RevealText>
        </header>

        <div />

        <footer
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
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

          <button
            type="button"
            onClick={startCountdown}
            disabled={phase !== "idle"}
            aria-label="Take photos"
            className="hover:opacity-50 transition-opacity"
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              // Generous tap target — the visual is just text, but the
              // padded box around it is the actual click area, so users
              // don't have to land precisely on the bracket characters.
              padding: "1.25rem 1.5rem",
              margin: "-1.25rem -1.5rem",
              fontFamily: "var(--font-abc)",
              fontSize: "var(--text-xs)",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              textAlign: "right",
              color: "var(--white)",
              mixBlendMode: "difference",
              cursor: phase === "idle" ? "pointer" : "default",
              pointerEvents: "auto",
            }}
          >
            [ press to capture ]
          </button>
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

function PrintOverlay({ phase }: { phase: "printing" | "printed" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      gsap.set(el, { autoAlpha: 1 });
      return;
    }
    gsap.fromTo(
      el,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.4, ease: "power2.out" },
    );
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,26,26,0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        gap: "1.25rem",
        gridAutoFlow: "row",
        zIndex: 30,
        opacity: 0,
        visibility: "hidden",
        color: "var(--white)",
      }}
    >
      <div style={{ display: "grid", placeItems: "center", gap: "1.25rem" }}>
        {phase === "printing" ? <Spinner size={36} /> : null}
        <span
          style={{
            fontFamily: "var(--font-abc)",
            fontSize: "var(--text-sm)",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
          }}
        >
          {phase === "printing" ? "printing…" : "printed"}
        </span>
      </div>
    </div>
  );
}
