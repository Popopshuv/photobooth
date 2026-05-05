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

  const uiRef = useRef<HTMLDivElement>(null);
  // Flash and capture race each other. When both finish we kick off the
  // compose+print pipeline.
  const flashedRef = useRef(false);
  const pendingPhotoRef = useRef<string | null>(null);

  const composeAndPrint = useCallback(async (photoUrl: string) => {
    try {
      // Send the photo and the receipt copy to the server. The server
      // composes the receipt using native ESC/POS commands — no canvas,
      // no PNG, no CUPS. Photo is the only bitmap; everything else
      // prints as crisp printer-rendered text.
      const photoBlob = await (await fetch(photoUrl)).blob();
      const form = new FormData();
      form.append("photo", photoBlob, "photo.jpg");
      form.append("brand", RECEIPT.brand);
      form.append("lines", JSON.stringify(RECEIPT.lines));
      form.append("feed_lines", String(RECEIPT.feedLines));

      const res = await fetch(printUrl(), { method: "POST", body: form });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `print failed (${res.status})`);
      }

      URL.revokeObjectURL(photoUrl);
      setPhase("printed");
      window.setTimeout(() => setPhase("idle"), PRINTED_HOLD_MS);
    } catch (e) {
      URL.revokeObjectURL(photoUrl);
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  const tryAdvanceToPrinting = useCallback(() => {
    if (!flashedRef.current || !pendingPhotoRef.current) return;
    const url = pendingPhotoRef.current;
    pendingPhotoRef.current = null;
    flashedRef.current = false;
    setPhase("printing");
    composeAndPrint(url);
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
    setPhase("countdown");
  }, [phase]);

  const onCountdownDone = useCallback(async () => {
    setPhase("flashing");
    try {
      const res = await fetch(captureUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error(`capture failed (${res.status})`);
      const blob = await res.blob();
      pendingPhotoRef.current = URL.createObjectURL(blob);
      tryAdvanceToPrinting();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [tryAdvanceToPrinting]);

  const onFlashDone = useCallback(() => {
    flashedRef.current = true;
    tryAdvanceToPrinting();
  }, [tryAdvanceToPrinting]);

  return (
    <>
      <Stage flash={phase === "flashing"} onFlashDone={onFlashDone} />

      <Countdown active={phase === "countdown"} onDone={onCountdownDone} />

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
            est. 2026
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
            aria-label="Take photo"
            className="hover:opacity-50 transition-opacity"
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              padding: 0,
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
