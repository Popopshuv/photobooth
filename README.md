# group-d-system

Brutalist-but-elevated starter — Next.js 16 + GSAP + R3F. Minimal layouts carried by cinematic micro-interactions.

The kit ships with: monospaced fluid typography, a tiny set of design tokens, one mask-wipe text-reveal primitive, a transition state machine for clean page-to-page motion, an opt-in fullscreen 3D canvas (single wireframe sphere by default), and a `useReveal` hook with named animation presets. Everything respects `prefers-reduced-motion`.

## Quick start

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

## What's inside

```
src/
  app/
    globals.css          # All design tokens. Single source of truth.
    layout.tsx           # Mounts <ClientShell>.
    page.tsx             # Thin server entry — imports HomeContent.
    HomeContent.tsx      # Demo page. Replace with your own copy.
  components/
    ClientShell.tsx      # Mounts TransitionController, optional canvas, PageReveal.
    TransitionController.tsx
    TransitionLink.tsx   # Use INSTEAD OF next/link for in-app nav.
    PageReveal.tsx       # Cross-fade wrapper around <main>.
    BackgroundCanvas.tsx # Optional fullscreen R3F canvas — wireframe sphere.
    RevealText.tsx       # Word-mask reveal. Wrap every text element.
  lib/
    prefersReducedMotion.ts
    useReveal.ts         # Hook for non-text reveals — preset or custom callback.
  store/
    useTransitionStore.ts # Zustand store for the page-transition state machine.
public/
  fonts/                 # ABC Monument Grotesk Mono (Light), self-hosted.
```

## Reveal presets

`useReveal(ref, preset)` ships with five presets — pick one before authoring a one-off `gsap.to`:

| Preset | What it does |
|---|---|
| `fade` | Opacity 0 → 1, `power2.out`, 0.6s |
| `fade-up` | Opacity + 20px translate, `power3.out`, 0.8s |
| `lift` | Opacity + 40px translate, `power3.out`, 1s |
| `mask` | Black mask wipe left → right, `power3.inOut`, 0.6s |
| `scale` | Opacity + 0.96 → 1 scale, `power3.out`, 0.8s |

Pass a callback `(el) => …` for anything custom. See `GROUP-D-SYSTEM.md` §2.3.

## Customising for a new project

The minimum changes for a new site:

1. `package.json` — change `name` and `description`.
2. `src/app/layout.tsx` — update `metadata.title`, `description`, OpenGraph.
3. `src/app/HomeContent.tsx` — replace the placeholder copy.
4. `src/components/ClientShell.tsx` — pass `canvas3d={false}` if you don't want the 3D backdrop.
5. `public/fonts/` — leave as-is unless the project licences a different face.

The motion system, transition shell, and tokens stay the same.

## Reference

- **`GROUP-D-SYSTEM.md`** — the full design guide. Tokens, motion specs, philosophy.
- **`CLAUDE.md` / `AGENTS.md`** — the rules an LLM must follow when extending this starter.

## Stack

- Next.js 16 (App Router), React 19
- Tailwind v4 + CSS variables
- GSAP (ScrollTrigger)
- `@react-three/fiber` + `@react-three/drei` + three.js
- Zustand (transition store)
- Lenis (available, not auto-mounted)
