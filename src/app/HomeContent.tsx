"use client";

import { useRef } from "react";
import { RevealText } from "@/components/RevealText";
import { useReveal } from "@/lib/useReveal";

export function HomeContent() {
  const accentRef = useRef<HTMLDivElement>(null);
  useReveal(accentRef, "fade-up", { delay: 0.6 });

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        padding: "var(--page-pad)",
        paddingTop: "6rem",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <section
        style={{
          marginLeft: "auto",
          maxWidth: "32rem",
          paddingRight: "var(--page-pad)",
        }}
      >
        <RevealText
          as="p"
          delay={0.3}
          triggerOnScroll={false}
          style={{
            fontSize: "var(--text-reg)",
            lineHeight: 1.7,
            letterSpacing: "0.02em",
          }}
        >
          Starter for the vibed out group dynamics apps.
        </RevealText>
      </section>

      <section
        style={{
          marginTop: "auto",
          paddingTop: "clamp(4rem, 12vh, 8rem)",
          marginLeft: "auto",
          maxWidth: "32rem",
          paddingRight: "var(--page-pad)",
          width: "100%",
        }}
      >
        <RevealText
          as="h1"
          triggerOnScroll={false}
          delay={0.6}
          stagger={0.015}
          style={{
            fontSize: "var(--text-reg)",
            lineHeight: 1.3,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          Group Dynamics
        </RevealText>

        <div
          ref={accentRef}
          style={{
            marginTop: "0.75rem",
            width: "2rem",
            height: "1px",
            background: "var(--red)",
          }}
        />
      </section>
    </div>
  );
}
