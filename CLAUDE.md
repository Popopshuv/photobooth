# CLAUDE.md — group-d-system

@AGENTS.md

You are working inside the **group-d-system** starter — a Group Dynamics opinionated kit for **brutalist but elevated** sites: minimal layouts carried by cinematic micro-interactions, perfect easings, and considered timing.

The full design reference lives in `GROUP-D-SYSTEM.md`. Read it before making non-trivial design or motion decisions. This file is the short version: **the rules you must follow without being asked.**

---

## The bar

Strip the surface. Layer motion on top. Elevation comes from timing and easing taste, not decoration.

Before you ship a screen, ask:

1. Could I delete a third of this and lose nothing?
2. Where does the eye land — and is that landing animated?
3. Is the motion _quiet_ (long durations, gentle eases) or _bouncy_? It should be quiet.

---

## Hard rules (do not violate without explicit permission)

### Tokens

- Never hardcode colours, font sizes, font families, or page padding. Use CSS variables from `src/app/globals.css` (`var(--black)`, `var(--text-reg)`, `var(--page-pad)`, etc.). If a value isn't a token, add it to `globals.css` first, then use it.
- Background `var(--white)` (`#fff`). Type `var(--black)` (`#1a1a1a`, never `#000`).
- Grays only from `--gray-1/2/3`. Don't introduce new neutrals.
- Red (`var(--red)`) is the only saturated colour. **One red moment per viewport, max.** If two reds are on screen, one is wrong.

### Typography

- Font: only `var(--font-abc)` (ABC Monument Grotesk Mono, Light 300). No second face, no Google Fonts.
- Sizes from the four tokens (`--text-reg`, `--text-tiny`, `--text-sm`, `--text-xs`). Headings are usually the _same size_ as body — they feel bigger via casing, tracking, position, and motion.
- Casing: body sentence-case; nav/labels/headings/eyebrows uppercase.
- Tracking: 0.02em body / 0.15em nav-labels / 0.2em headings / 0.3em micro-eyebrows.

### Motion

- All animation goes through GSAP. No Framer Motion, AnimeJS, Motion One, or hand-rolled CSS keyframes for anything beyond `transition-opacity` on hover.
- **Every text element gets a reveal animation.** Wrap it in `<RevealText>` — never render static text.
- For non-text reveals, use `useReveal` from `@/lib/useReveal`. Prefer a named preset (`fade`, `fade-up`, `lift`, `mask`, `scale`) over a custom callback. Don't author one-off `gsap.to` calls in components — extend the presets in `useReveal.ts` if a recurring pattern is missing.
- Easings: `power2.out`, `power2.inOut`, `power3.out`, `power3.inOut`. Forbidden by default: `back`, `elastic`, `bounce`, `expo`. If you reach for one, ask first.
- Durations: text masks `0.4–0.6s`, settles `0.8–1s`, page fades `0.3–0.6s`, image fades `0.8s`. Stagger `0.04–0.1s`.
- Hover is opacity-only (`hover:opacity-50 transition-opacity`). No colour shifts, no underlines, no scale.
- Every new animation must check `prefersReducedMotion()` and snap to its end state. `<RevealText>` and `useReveal` already do.

### State and routing

- `useTransitionStore` is the page-transition state machine. Phases: `idle | exiting | navigating | entering | revealing`. Don't duplicate transition state in another store, context, or local refs. Don't extend it with non-transition data.
- App state outside transitions (modals, fetched data, user prefs) belongs in its own store — separate Zustand stores are fine.
- Internal nav uses `<TransitionLink>`. External links use plain `<a target="_blank" rel="noopener noreferrer">`.
- Don't bypass the store with raw `router.push` calls in click handlers.

### Layout shell

- Every route is wrapped by `<ClientShell>` (already mounted in `app/layout.tsx`). The shell mounts `<TransitionController>`, optional `<BackgroundCanvas>`, and `<PageReveal>`. Don't re-mount any of those in a page.
- Pass `canvas3d={false}` to `<ClientShell>` to disable the 3D backdrop. Don't add a second canvas.
- Route `page.tsx` is a server component that imports a co-located `*Content.tsx` client component. Don't put `"use client"` on `page.tsx`.

### Dependencies

- Stay within the existing kit (Next.js 16, Tailwind v4, GSAP, Lenis, R3F, drei, three, zustand). Adding a new dep requires explicit approval — propose it before installing.

---

## Soft rules (defaults)

- One accent per page.
- Asymmetry over centring. Layouts feel hand-placed, not gridded.
- If a screen needs more than three text blocks and one accent, you're probably building something the kit already has. Look first.

---

## When in doubt

- **Read `GROUP-D-SYSTEM.md`** for the long-form rationale, full token list, motion specs, and the `useReveal` preset list.
- **Read the existing component** before writing a new one. The patterns are short; reuse beats parallel implementations.
- **Read `node_modules/next/dist/docs/`** before assuming Next.js APIs — this starter pins Next.js 16, which may differ from your training data.
- If a request would require breaking one of the hard rules above, **stop and ask.** The aesthetic only holds if every page follows the same constraints.
