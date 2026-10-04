"use client";

// Stacked contribution bar: each segment is w·factor, so the bar's length IS the score.
// 2px surface gaps between segments, 4px rounded data-end (dataviz mark spec).

import { motion } from "motion/react";
import { useState } from "react";
import type { Weights } from "@/lib/engine/types";
import { FACTORS } from "@/lib/engine/types";
import { FACTOR_META } from "@/lib/factors";
import { cx } from "@/lib/format";
import { ease } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

export function ScoreBar({
  factors,
  weights,
  height = 8,
  max = 1,
  delay = 0,
  className,
  muted = false,
}: {
  factors: Weights;
  weights: Weights;
  height?: number;
  max?: number;
  delay?: number;
  className?: string;
  muted?: boolean;
}) {
  const reduced = useReducedMotion();
  const [tip, setTip] = useState<string | null>(null);
  const parts = FACTORS.map((f) => ({ f, c: weights[f] * factors[f] }));
  const total = parts.reduce((s, p) => s + p.c, 0);
  // Segments are hover-only (they often sit inside a clickable row); the full breakdown
  // is in the accessible label, the memory drawer and the Retrieval lab's table.
  const summary = `Score ${total.toFixed(3)}: ${parts.map(({ f, c }) => `${FACTOR_META[f].name} ${factors[f].toFixed(2)} × ${weights[f].toFixed(2)} = ${c.toFixed(3)}`).join("; ")}`;
  return (
    <div className={cx("relative", className)} role="img" aria-label={summary}>
      <div className="flex w-full items-center gap-[2px]" style={{ height }}>
        {parts.map(({ f, c }, i) => {
          const pct = (c / max) * 100;
          const last = i === parts.length - 1;
          return (
            <motion.span
              key={f}
              aria-hidden
              onPointerEnter={() => setTip(f)}
              onPointerLeave={() => setTip(null)}
              className={cx("relative block h-full shrink-0", last ? "rounded-r-[4px]" : "", i === 0 ? "rounded-l-[2px]" : "")}
              style={{ background: FACTOR_META[f].color, opacity: muted ? 0.4 : tip && tip !== f ? 0.55 : 1 }}
              initial={reduced ? false : { width: 0 }}
              animate={{ width: `calc(${pct}% - 2px)` }}
              transition={{ delay: delay + i * 0.11, duration: 0.5, ease: ease.out }}
            />
          );
        })}
      </div>
      {tip && (
        <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 whitespace-nowrap rounded-[8px] border border-shelf bg-abyss/95 px-2.5 py-1.5 shadow-lg">
          <p className="data text-foam">
            <span className="font-[620]">{(weights[tip as keyof Weights] * factors[tip as keyof Weights]).toFixed(3)}</span>
            <span className="text-kelp">
              {" "}
              = {factors[tip as keyof Weights].toFixed(2)} × {weights[tip as keyof Weights].toFixed(2)}
            </span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-kelp">
            <span className="inline-block h-[2px] w-3 rounded" style={{ background: FACTOR_META[tip as keyof Weights].color }} />
            {FACTOR_META[tip as keyof Weights].name} · score {total.toFixed(3)}
          </p>
        </div>
      )}
    </div>
  );
}

export function FactorLegend({ className }: { className?: string }) {
  return (
    <ul className={cx("flex flex-wrap items-center gap-x-3 gap-y-1", className)} aria-label="Score signals">
      {FACTORS.map((f) => (
        <li key={f} className="flex items-center gap-1.5 text-[11px] text-kelp" title={FACTOR_META[f].desc}>
          <span className="inline-block h-2 w-2.5 rounded-[2px]" style={{ background: FACTOR_META[f].color }} />
          {FACTOR_META[f].name}
        </li>
      ))}
    </ul>
  );
}
