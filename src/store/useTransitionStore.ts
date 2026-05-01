import { create } from "zustand";

export type TransitionPhase =
  | "idle"
  | "exiting"
  | "navigating"
  | "entering"
  | "revealing";

interface TransitionState {
  phase: TransitionPhase;
  targetPath: string | null;
  setPhase: (phase: TransitionPhase) => void;
  startTransition: (path: string) => void;
  completeTransition: () => void;
}

export const useTransitionStore = create<TransitionState>((set) => ({
  phase: "idle",
  targetPath: null,
  setPhase: (phase) => set({ phase }),
  startTransition: (path) => set({ phase: "exiting", targetPath: path }),
  completeTransition: () => set({ phase: "idle", targetPath: null }),
}));
