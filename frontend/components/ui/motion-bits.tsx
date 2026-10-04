"use client";

// Small animated primitives: numbers that tick, text that morphs from machine to
// human, headlines that "inhale", meters that spring.

import { motion, useMotionValueEvent, useSpring, type MotionStyle } from "motion/react";
import { useEffect, useRef } from "react";
import { cx } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

export function NumberTicker({
  value,
  format = (n) => Math.round(n).toLocaleString("en-IN"),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const mv = useSpring(value, { stiffness: 120, damping: 22 });
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reduced) mv.jump(value);
    else mv.set(value);
  }, [value, reduced, mv]);
  useMotionValueEvent(mv, "change", (v) => {
    if (ref.current) ref.current.textContent = format(v);
  });
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}

/** Recursive Mono → Sans once `settled` is true: raw input becoming understood. */
export function MorphText({ settled, children, className }: { settled: boolean; children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className={className}
      initial={false}
      animate={{ ["--mono" as const]: settled ? 0 : 1 }}
      transition={{ duration: reduced ? 0 : 0.9, ease: ease.inOut }}
      style={{ "--mono": settled ? 0 : 1 } as MotionStyle}
    >
      {children}
    </motion.span>
  );
}

export interface Word {
  text: string;
  wdth?: number;
  className?: string;
}

/** Display headline: words rise in and "inhale" from narrow to their final width. */
export function DisplayText({
  lines,
  className,
  delay = 0,
  as: Tag = "h1",
  base = 96,
}: {
  lines: Word[][];
  className?: string;
  delay?: number;
  as?: "h1" | "h2" | "p";
  base?: number;
}) {
  const reduced = useReducedMotion();
  let i = 0;
  const MotionTag = motion[Tag];
  return (
    <MotionTag className={className} initial="hidden" animate="show">
      {lines.map((line, li) => (
        <span key={li} className="block">
          {line.map((w, wi) => {
            const idx = i++;
            const target = w.wdth ?? base;
            return (
              <motion.span
                key={wi}
                className={cx("inline-block whitespace-pre", w.className)}
                variants={{
                  hidden: reduced
                    ? { opacity: 0 }
                    : { opacity: 0, y: "0.32em", filter: "blur(10px)", ["--wdth" as const]: 58 },
                  show: {
                    opacity: 1,
                    y: 0,
                    filter: "blur(0px)",
                    ["--wdth" as const]: target,
                    transition: { delay: delay + idx * 0.07, duration: reduced ? 0.2 : 0.95, ease: ease.out },
                  },
                }}
                style={{ "--wdth": target } as MotionStyle}
              >
                {w.text}
                {wi < line.length - 1 ? " " : ""}
              </motion.span>
            );
          })}
        </span>
      ))}
    </MotionTag>
  );
}

export function Meter({
  value,
  tone = "var(--color-foam)",
  track = "color-mix(in oklab, var(--color-shelf) 70%, transparent)",
  className,
  height = 4,
  label,
}: {
  value: number;
  tone?: string;
  track?: string;
  className?: string;
  height?: number;
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cx("relative w-full overflow-hidden rounded-full", className)}
      style={{ height, background: track }}
      role={label ? "meter" : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 1 : undefined}
      aria-valuenow={label ? Number(v.toFixed(2)) : undefined}
    >
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: tone }}
        initial={false}
        animate={{ width: `${v * 100}%` }}
        transition={spring.fluid}
      />
    </div>
  );
}
