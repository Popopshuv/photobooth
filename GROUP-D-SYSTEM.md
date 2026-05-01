# GROUP-D-SYSTEM

The design system for every Group Dynamics build.

**The bar in one line: brutalist but elevated.** Strip the layout to almost nothing. Then layer cinematic micro-interactions, perfect easings, and considered timing on top so the page never feels static. The "elevated" comes from motion taste, not from decoration.

If a section looks done but boring, the answer is _less content + better motion_, never more visual stuff.

---

## 1. Tokens

All tokens live in `src/app/globals.css`. **Never hardcode colours, font sizes, or page padding in components — use the variable.** If you need a value that isn't a token, add it to `globals.css` first.

### 1.1 Colour

| Token      | Hex       | Use                                           |
| ---------- | --------- | --------------------------------------------- |
| `--white`  | `#ffffff` | Page background                               |
| `--black`  | `#1a1a1a` | All type, masks                               |
| `--gray-1` | `#f1f1f1` | Subtle dividers, hover backgrounds            |
| `--gray-2` | `#e7e6e6` | Mid neutrals, secondary surfaces              |
| `--gray-3` | `#bfb5af` | Deeper neutral, captions                      |
| `--red`    | `#ff0000` | Accent. **One red moment per viewport, max.** |

Rules:

- White background, black text. Never `#000` — always `--black`.
- Grays carry weight; reach for them before introducing a new token.
- Red is the only saturated colour on the site. Reserve it for a single accent per page (one underline on hover, one icon, one indicator). If two reds end up on screen at once, one is wrong.

### 1.2 Type

```
font-family: var(--font-abc);   /* ABC Monument Grotesk Mono, weight 300 only */
```

| Token         | Size        | Use                    |
| ------------- | ----------- | ---------------------- |
| `--text-reg`  | `0.6875rem` | Body copy, h1, primary |
| `--text-tiny` | `0.625rem`  | Secondary copy         |
| `--text-sm`   | `0.5625rem` | Nav, footer, labels    |
| `--text-xs`   | `0.5rem`    | Eyebrow micro-labels   |

Root font-size is fluid: `clamp(12px, 1.5vw + 8px, 16px)`. Every `rem` scales with the viewport — no media queries needed for type.

**Tracking and casing:**

| Use                  | letter-spacing | text-transform |
| -------------------- | -------------- | -------------- |
| Body                 | `0.02em`       | sentence-case  |
| Nav / labels         | `0.15em`       | UPPERCASE      |
| Headings             | `0.2em`        | UPPERCASE      |
| Eyebrow micro-labels | `0.3em`        | UPPERCASE      |

Headings are usually the _same size_ as body. They feel bigger because of casing, tracking, position, and motion — never bumped font-size.

### 1.3 Spacing

```
--page-pad: clamp(1rem, 3vw, 2.5rem);
```

All page-level horizontal/vertical padding uses `var(--page-pad)`. Don't invent new spacing scales.

### 1.4 Other

- Border radius: always square.
- No shadows. No gradients. Depth comes from layered z-index and motion.
- Borders, when needed: `1px solid rgba(0,0,0,0.08)`.

---

## 2. Motion

Motion is the brand. The aesthetic only holds if every page follows the same motion grammar.

### 2.1 Every text element gets the reveal

Body, heading, label — if it's text on screen, wrap it in `<RevealText>` (`src/components/RevealText.tsx`). Word-by-word mask wipe. It already gates on the page-transition phase and honours `prefers-reduced-motion`.

```tsx
<RevealText as="h1" delay={0.6} stagger={0.015}>
  Group Dynamics
</RevealText>
```

- Default: arms a `ScrollTrigger` at `top 95%`, fires once on scroll.
- `triggerOnScroll={false}` — fire on mount instead, for above-the-fold copy.
- `delay`, `stagger` — tune timing.

If you're rendering static text without `<RevealText>`, you're breaking the system.

### 2.2 Easings (memorise these)

| Use           | Easing                     | Duration      |
| ------------- | -------------------------- | ------------- |
| Mask wipes    | `power3.inOut`             | `0.4 – 0.6s`  |
| Settles       | `power3.out`               | `0.8 – 1s`    |
| Page fades    | `power2.out` / `power2.in` | `0.3 – 0.6s`  |
| Image fade-in | `power2.out`               | `0.8s`        |
| Stagger       | —                          | `0.04 – 0.1s` |

**Forbidden by default:** `back`, `elastic`, `bounce`, `expo`. The energy comes from staggered timing and layered systems, not springiness. If a brief calls for one of these, ask first.

### 2.3 Animating non-text elements → use `useReveal`

When you need to animate an image, a div, a card, a 3D scene wrapper — **don't author a one-off `gsap.to`**. Use the hook in `src/lib/useReveal.ts`. Pick a preset; pass a callback only for genuine one-offs.

Five presets cover ~90% of cases:

| Preset    | What it does                                                       |
| --------- | ------------------------------------------------------------------ |
| `fade`    | Opacity 0 → 1. `power2.out`, 0.6s.                                 |
| `fade-up` | Opacity + 20px translate. `power3.out`, 0.8s.                      |
| `lift`    | Opacity + 40px translate. `power3.out`, 1s.                        |
| `mask`    | Black mask wipes left → right via clip-path. `power3.inOut`, 0.6s. |
| `scale`   | Opacity + 0.96 → 1 scale. `power3.out`, 0.8s.                      |

```tsx
"use client";
import { useRef } from "react";
import { useReveal } from "@/lib/useReveal";

export function ProjectCard() {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, "fade-up", { delay: 0.2 });
  return <div ref={ref}>...</div>;
}
```

Custom one-off:

```tsx
useReveal(ref, (el) => {
  gsap.from(el.querySelector("img"), {
    clipPath: "inset(100% 0 0 0)",
    duration: 1,
    ease: "power3.inOut",
  });
});
```

Options:

- `start` — ScrollTrigger position (default `"top 85%"`).
- `once` — fire once vs every entry (default `true`).
- `triggerOnScroll` — set `false` for on-mount instead of on-scroll.
- `delay` / `duration` — override preset timing.

The hook handles three things you'd otherwise rewrite every time:

1. Gates on the page being settled (`idle`/`revealing`) so reveals don't fire mid-transition.
2. Sets up a one-shot `ScrollTrigger`.
3. Skips the tween entirely under `prefers-reduced-motion`.

If your animation needs scroll-scrubbed timeline behaviour (parallax, continuous progress), use `gsap`/`ScrollTrigger` directly — `useReveal` is for one-shot reveals.

### 2.4 Hover and idle

- Hover: `hover:opacity-50 transition-opacity`. That's it. No colour shifts, no underlines, no scale.
- Cursor: default.
- The "wow" lives in entrances and transitions. Keep idle states quiet so entrances feel bigger by contrast.

### 2.5 The transition state machine

Page transitions run through `useTransitionStore` (Zustand). Phases:

```
idle → exiting → navigating → entering → revealing → idle
```

- Internal nav: **always** `<TransitionLink>`, never `next/link` or raw `router.push`.
- New phase-aware effects: subscribe to the store; never `setTimeout` to guess where the page is.
- The store is for transitions only. If you need app state (a modal, fetched data, user prefs), put it in its own store — don't extend `useTransitionStore`.

---

## 3. The 3D canvas

`<BackgroundCanvas>` is mounted by `<ClientShell>` by default. It renders a single black wireframe sphere, slowly rotating, behind the page (`zIndex: 0`, `pointerEvents: none`).

To opt out for a route or for the whole app:

```tsx
<ClientShell canvas3d={false}>{children}</ClientShell>
```

To replace the sphere with something richer, edit `BackgroundCanvas.tsx` directly. Keep it black wireframe — additional colour or fills compete with the page content.

---

## 4. Designing a new screen

There is no template. Compose what the brief needs — but every screen should feel like it came out of the same studio.

What that means in practice:

- **Empty looks intentional.** Three or four elements with a lot of whitespace is the default, not a failure of imagination.
- **One thing moves at a time.** Multiple competing animations cancel each other out; the eye should know where to land.
- **Timing carries the weight.** A 0.6s mask wipe with `power3.inOut` and a 0.04s stagger is the elevation. Get the easing and the stagger right before adding anything else.
- **Asymmetry over centring.** Hand-placed feels more confident than gridded. Offset, anchor to an edge, let things breathe unevenly.
- **One accent per page.** One red moment, one 3D backdrop. Stacking accents kills the calm.

Before shipping, ask:

1. Could I delete a third of this and lose nothing?
2. Where does the eye land — and is that landing animated?
3. Is the motion _quiet_ (long durations, gentle eases) or _bouncy_? It should be quiet.

---

## 5. Stack

| Layer         | Choice                                                                             |
| ------------- | ---------------------------------------------------------------------------------- |
| Framework     | Next.js 16 (App Router), React 19                                                  |
| Styling       | Tailwind v4 + CSS variables in `globals.css`                                       |
| Animation     | GSAP + ScrollTrigger                                                               |
| 3D (optional) | `@react-three/fiber`, `@react-three/drei`, three                                   |
| State         | Zustand — `useTransitionStore` for transitions; add others as needed for app state |
| Smooth scroll | Lenis (available, not auto-mounted)                                                |
| Fonts         | ABC Monument Grotesk Mono Light, self-hosted woff2                                 |

GSAP is the single source of truth for animation. No Framer Motion, no AnimeJS, no hand-rolled CSS keyframes for anything beyond `transition-opacity`. Adding a new dependency requires explicit approval — propose it before installing.

---

## 6. Accessibility baselines

- Respect `prefers-reduced-motion`. `<RevealText>` and `useReveal` already do — match the pattern in any new animation you write by hand.
- Interactive hit targets ≥ 24×24 even when visually smaller.
- Self-host fonts (`woff2` + `woff` fallback, `font-display: swap`).
- Images: prefer `.webp`, lazy-load below the fold, set `width`/`height` to prevent CLS.
