"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTransitionStore } from "@/store/useTransitionStore";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";

gsap.registerPlugin(ScrollTrigger);

interface RevealTextProps {
  children: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
  /** Fire on scroll-into-view (default) vs immediately on mount. */
  triggerOnScroll?: boolean;
  stagger?: number;
}

export function RevealText({
  children,
  as: Tag = "div",
  className = "",
  style,
  delay = 0,
  triggerOnScroll = true,
  stagger = 0.06,
}: RevealTextProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  const animatedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    animatedRef.current = false;

    const masks = el.querySelectorAll(".reveal-mask") as NodeListOf<HTMLElement>;
    const items = el.querySelectorAll(".reveal-item") as NodeListOf<HTMLElement>;

    gsap.set(items, { visibility: "visible" });
    gsap.set(masks, { scaleX: 1, transformOrigin: "right center" });

    const animate = () => {
      if (animatedRef.current) return;
      animatedRef.current = true;

      if (prefersReducedMotion()) {
        masks.forEach((m) => { m.style.display = "none"; });
        return;
      }

      gsap.to(masks, {
        scaleX: 0,
        duration: 0.4,
        stagger: { each: stagger * 0.7, from: "random" },
        ease: "power3.inOut",
        delay,
        onComplete: () => {
          masks.forEach((m) => { m.style.display = "none"; });
        },
      });
    };

    const setupTrigger = () => {
      if (triggerOnScroll) {
        ScrollTrigger.create({
          trigger: el,
          start: "top 95%",
          once: true,
          onEnter: animate,
        });
      } else {
        animate();
      }
    };

    // Gate on page being settled — don't fire during exit/swap so reveals
    // never happen while the page is invisible.
    const isReady = (s: ReturnType<typeof useTransitionStore.getState>) =>
      s.phase === "idle" || s.phase === "revealing";

    let unsub: (() => void) | undefined;
    if (isReady(useTransitionStore.getState())) {
      setupTrigger();
    } else {
      unsub = useTransitionStore.subscribe((state) => {
        if (isReady(state)) {
          unsub?.();
          setupTrigger();
        }
      });
    }

    return () => {
      unsub?.();
      ScrollTrigger.getAll().forEach((t) => {
        if (t.trigger === el) t.kill();
      });
    };
  }, [children, delay, stagger, triggerOnScroll]);

  const words = children.split(/\s+/);

  return (
    <Tag ref={ref} className={className} style={style}>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          style={{
            display: "inline-flex",
            marginRight: "0.25em",
            position: "relative",
            overflow: "hidden",
            verticalAlign: "baseline",
            lineHeight: "inherit",
          }}
        >
          <span
            className="reveal-item"
            style={{ display: "inline-block", visibility: "hidden", lineHeight: "inherit" }}
          >
            {word}
          </span>
          <span
            className="reveal-mask"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "calc(100% + 0.05em)",
              height: "100%",
              backgroundColor: "var(--black)",
              transformOrigin: "right center",
              zIndex: 2,
            }}
          />
        </span>
      ))}
    </Tag>
  );
}
