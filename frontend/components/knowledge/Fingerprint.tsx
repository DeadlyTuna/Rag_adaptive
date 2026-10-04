"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import { fingerprint } from "@/lib/engine/embed";
import { useReducedMotion } from "@/lib/reduced-motion";

/**
 * 32 values from the passage's embedding (a random projection of all 384 dims) on a
 * diverging scale: glacier (negative) ← shelf (≈0) → rhodamine (positive).
 */
export function Fingerprint({ text, cells = 32, animate = false, delay = 0, className }: { text: string; cells?: number; animate?: boolean; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  const values = useMemo(() => fingerprint(text, cells), [text, cells]);
  return (
    <span className={className ?? "flex h-3 gap-[2px]"} role="img" aria-label="Embedding fingerprint">
      {values.map((v, i) => {
        const pole = v < 0 ? "var(--color-glacier)" : "var(--color-rhodamine)";
        const amt = Math.round(Math.min(1, Math.abs(v)) * 88);
        return (
          <motion.span
            key={i}
            className="block h-full flex-1 rounded-[2px]"
            style={{ background: `color-mix(in oklab, ${pole} ${amt}%, var(--color-shelf))` }}
            initial={animate && !reduced ? { opacity: 0, scaleY: 0.2 } : false}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ delay: delay + i * 0.012, duration: 0.25 }}
          />
        );
      })}
    </span>
  );
}
