"use client";

import { motion } from "motion/react";
import { cx } from "@/lib/format";
import { ease } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

/**
 * The current value written over the one it replaced — the old value stays faintly
 * visible underneath, struck through. Knowledge that evolves, not knowledge that piles up.
 */
export function Palimpsest({
  current,
  previous,
  className,
  animate = false,
}: {
  current: React.ReactNode;
  previous?: React.ReactNode;
  className?: string;
  animate?: boolean;
}) {
  const reduced = useReducedMotion();
  if (!previous) return <span className={className}>{current}</span>;
  return (
    <span className={cx("relative inline-block", className)}>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute left-[0.14em] top-[-0.42em] select-none whitespace-nowrap text-kelp/45"
        initial={animate && !reduced ? { opacity: 1, y: "0.42em", x: "-0.14em" } : false}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ delay: 0.5, duration: 0.7, ease: ease.inOut }}
      >
        <span className="relative">
          {previous}
          <motion.span
            className="absolute left-[-4%] top-1/2 h-[0.08em] min-h-[1.5px] w-[108%] origin-left bg-sodium/70"
            initial={animate && !reduced ? { scaleX: 0 } : false}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.45, ease: ease.out }}
          />
        </span>
      </motion.span>
      <motion.span
        className="relative inline-block"
        initial={animate && !reduced ? { opacity: 0, y: "0.25em", filter: "blur(6px)" } : false}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ delay: 0.75, duration: 0.6, ease: ease.out }}
      >
        {current}
      </motion.span>
      <span className="sr-only"> (replaces {previous})</span>
    </span>
  );
}
