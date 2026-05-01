"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { canvasToPng, composeReceipt } from "@/lib/receiptCanvas";
import { PRINT_URL } from "@/lib/photoboothConfig";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";

type Status = "composing" | "ready" | "printing" | "printed" | "error";

interface ReceiptPreviewProps {
  /** The captured still as an object URL. */
  photoUrl: string;
  onClose: () => void;
}

export function ReceiptPreview({ photoUrl, onClose }: ReceiptPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<Status>("composing");
  const [error, setError] = useState<string | null>(null);

  // Compose the receipt as soon as we have a photo.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = photoUrl;
        await img.decode();

        const canvas = await composeReceipt({ photo: img, width: 800 });
        if (cancelled) return;

        canvasRef.current = canvas;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";
        const slot = slotRef.current;
        if (slot) {
          slot.innerHTML = "";
          slot.appendChild(canvas);
        }
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  // Reveal animation on the overlay.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      gsap.set(el, { autoAlpha: 1 });
      return;
    }
    gsap.fromTo(
      el,
      { autoAlpha: 0, y: 24 },
      { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out" },
    );
  }, []);

  const handlePrint = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStatus("printing");
    try {
      const blob = await canvasToPng(canvas);
      const res = await fetch(PRINT_URL, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `print failed (${res.status})`);
      }
      setStatus("printed");
      window.setTimeout(onClose, 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  return (
    <div
      ref={wrapRef}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,26,26,0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        padding: "var(--page-pad)",
        zIndex: 30,
        opacity: 0,
        visibility: "hidden",
      }}
    >
      <div
        ref={slotRef}
        style={{
          maxHeight: "70vh",
          maxWidth: "min(420px, 100%)",
          background: "var(--white)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          overflowY: "auto",
          overflowX: "hidden",
          // Scale the canvas down to fit the slot.
          // The actual <canvas> is appended in the effect.
          display: "grid",
          placeItems: "center",
        }}
      >
        {status === "composing" && (
          <div
            style={{
              padding: "3rem",
              fontSize: "var(--text-sm)",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--gray-3)",
            }}
          >
            composing…
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          fontSize: "var(--text-sm)",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "var(--white)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={status === "printing"}
          className="hover:opacity-50 transition-opacity"
          style={buttonStyle()}
        >
          retake
        </button>

        <button
          type="button"
          onClick={handlePrint}
          disabled={status !== "ready"}
          className="hover:opacity-50 transition-opacity"
          style={buttonStyle({ accent: true })}
        >
          {status === "printing"
            ? "printing…"
            : status === "printed"
              ? "printed"
              : "print"}
        </button>
      </div>

      {status === "error" && error && (
        <div
          style={{
            fontSize: "var(--text-xs)",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--gray-3)",
            maxWidth: "32rem",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function buttonStyle({ accent = false }: { accent?: boolean } = {}): React.CSSProperties {
  return {
    appearance: "none",
    background: "transparent",
    color: accent ? "var(--red)" : "var(--white)",
    border: `1px solid ${accent ? "var(--red)" : "var(--white)"}`,
    padding: "0.75rem 1.25rem",
    fontFamily: "var(--font-abc)",
    fontSize: "var(--text-sm)",
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    cursor: "pointer",
  };
}
