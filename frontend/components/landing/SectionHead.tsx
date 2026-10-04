"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";
import type { Word } from "@/components/ui/motion-bits";
import { cx } from "@/lib/format";
import { ease } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

/** Section opener: eyebrow, a display headline whose words "inhale" into view, body copy. */
export function SectionHead({
  eyebrow,
  words,
  children,
  className,
}: {
  eyebrow: string;
  words: Word[];
  children?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduced = useReducedMotion();
  return (
    <div ref={ref} className={cx("max-w-[560px]", className)}>
      <motion.p
        className="label"
        initial={{ opacity: 0, y: 6 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, ease: ease.out }}
      >
        {eyebrow}
      </motion.p>
      <h2 className="t-display-l mt-4 text-foam">
        {words.map((w, i) => (
          <motion.span
            key={i}
            className={cx("inline-block whitespace-pre", w.className)}
            style={{ ["--wdth" as string]: w.wdth ?? 96 }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.3em", filter: "blur(8px)", ["--wdth" as string]: 60 }}
            animate={inView ? { opacity: 1, y: 0, filter: "blur(0px)", ["--wdth" as string]: w.wdth ?? 96 } : {}}
            transition={{ delay: 0.08 + i * 0.06, duration: reduced ? 0.2 : 0.9, ease: ease.out }}
          >
            {w.text}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        ))}
      </h2>
      {children && (
        <motion.div
          className="mt-5 space-y-3 text-[16.5px] leading-relaxed text-kelp"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.35, duration: 0.6, ease: ease.out }}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}
