"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { canvasToPng, composeReceipt } from "@/lib/receiptCanvas";
import { printUrl } from "@/lib/photoboothConfig";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";

type Status = "composing" | "ready" | "saving" | "saved" | "printing" | "printed" | "error";

interface ReceiptPreviewProps {
  /** The captured still as an object URL. */
  photoUrl: string;
  onClose: () => void;
}

/**
 * Renders the composed receipt as an `<img>` (no imperative DOM ops, so
 * React's reconciliation never trips over a node it didn't render). The
 * underlying PNG blob is reused for both SAVE (download) and PRINT.
 */
export function ReceiptPreview({ photoUrl, onClose }: ReceiptPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("composing");
  const [error, setError] = useState<string | null>(null);

  // Compose the receipt as soon as we have a photo.
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    const run = async () => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = photoUrl;
        await img.decode();

        const canvas = await composeReceipt({ photo: img });
        if (cancelled) return;

        const blob = await canvasToPng(canvas);
        if (cancelled) return;

        blobRef.current = blob;
        createdUrl = URL.createObjectURL(blob);
        setPreviewSrc(createdUrl);
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
      if (createdUrl) URL.revokeObjectURL(createdUrl);
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

  const filename = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    return `groupdynamics-${stamp}.png`;
  };

  const handleSave = () => {
    const blob = blobRef.current;
    if (!blob) return;
    setStatus("saving");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus("saved");
    window.setTimeout(() => setStatus("ready"), 1200);
  };

  const handlePrint = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setStatus("printing");
    try {
      const res = await fetch(printUrl(), {
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

  const busy = status === "saving" || status === "printing";

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
        style={{
          maxHeight: "70vh",
          maxWidth: "min(420px, 100%)",
          background: "var(--white)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          overflowY: "auto",
          overflowX: "hidden",
          display: "grid",
          placeItems: "center",
          minHeight: "8rem",
          minWidth: "min(320px, 100%)",
        }}
      >
        {previewSrc ? (
          // The composed receipt — derived from the same blob we'll print/save.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt="receipt preview"
            style={{ display: "block", width: "100%", height: "auto" }}
          />
        ) : (
          <div
            style={{
              padding: "3rem",
              fontSize: "var(--text-sm)",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--gray-3)",
            }}
          >
            {status === "error" ? "compose failed" : "composing…"}
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
          disabled={busy}
          className="hover:opacity-50 transition-opacity"
          style={buttonStyle()}
        >
          retake
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={status !== "ready" && status !== "saved"}
          className="hover:opacity-50 transition-opacity"
          style={buttonStyle()}
        >
          {status === "saving" ? "saving…" : status === "saved" ? "saved" : "save"}
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
