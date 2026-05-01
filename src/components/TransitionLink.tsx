"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransitionStore } from "@/store/useTransitionStore";
import { useCallback, type ReactNode, type MouseEvent } from "react";

interface TransitionLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
}

export function TransitionLink({
  href,
  children,
  className,
}: TransitionLinkProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { phase, startTransition } = useTransitionStore();

  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();

      // Don't transition if already transitioning or same page
      if (phase !== "idle" || pathname === href) return;

      startTransition(href);
    },
    [href, pathname, phase, startTransition, router]
  );

  return (
    <a href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  );
}
