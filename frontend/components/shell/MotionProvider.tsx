"use client";

import { MotionConfig } from "motion/react";

/** Motion follows the OS "reduce motion" setting: transforms and layout animations are skipped. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
