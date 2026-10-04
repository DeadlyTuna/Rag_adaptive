// Motion tokens — DESIGN_PLAN.md §3.2. Springs for what you touch, curves for what happens.

import type { Transition } from "motion/react";

export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
  in: [0.55, 0, 1, 0.45] as [number, number, number, number],
};

export const spring = {
  snap: { type: "spring", stiffness: 520, damping: 38, mass: 0.9 } satisfies Transition,
  fluid: { type: "spring", stiffness: 220, damping: 26 } satisfies Transition,
  lazy: { type: "spring", stiffness: 90, damping: 20 } satisfies Transition,
};

export const t = {
  instant: 0.09,
  quick: 0.16,
  base: 0.26,
  slow: 0.42,
  scene: 0.9,
  epic: 1.6,
};

export const stagger = {
  list: 0.045,
  bars: 0.08,
  words: 0.07,
};

/** Standard "rise into place" entrance. */
export const rise = {
  initial: { opacity: 0, y: 10, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6, filter: "blur(4px)", transition: { duration: t.quick, ease: ease.in } },
  transition: { duration: t.slow, ease: ease.out },
};
