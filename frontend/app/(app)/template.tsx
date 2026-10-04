"use client";

import { motion } from "motion/react";
import { ease } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

/** Page change: content fades up 10px while a 6px blur clears (DESIGN_PLAN.md §3.3 G). */
export default function Template({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(6px)" }}
      // clear transform/filter afterwards so fixed-position children aren't re-anchored
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" } }}
      transition={{ duration: reduced ? 0.15 : 0.42, ease: ease.out }}
    >
      {children}
    </motion.div>
  );
}
