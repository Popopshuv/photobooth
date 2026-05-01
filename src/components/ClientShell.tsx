"use client";

import { type ReactNode } from "react";
import { BackgroundCanvas } from "./BackgroundCanvas";
import { TransitionController } from "./TransitionController";
import { PageReveal } from "./PageReveal";

interface ClientShellProps {
  children: ReactNode;
  /** Mount the fullscreen 3D canvas. Default `true`. Set to `false` to opt out. */
  canvas3d?: boolean;
}

export function ClientShell({ children, canvas3d = false }: ClientShellProps) {
  return (
    <>
      <TransitionController />
      {canvas3d && <BackgroundCanvas />}
      <main className="relative z-10 min-h-screen">
        <PageReveal>{children}</PageReveal>
      </main>
    </>
  );
}
