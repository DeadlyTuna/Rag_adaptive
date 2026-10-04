"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { Glyph } from "@/components/ui/Glyph";
import { SectionHead } from "./SectionHead";
import { isoDay } from "@/lib/format";
import { ease } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

const TODAY = isoDay(Date.now());

function FactCard({ side, value, source, confidence, old, play }: { side: "old" | "new"; value: string; source: string; confidence: string; old?: boolean; play: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: side === "old" ? -24 : 24 }}
      animate={play ? { opacity: old ? [1, 1, 0.55] : 1, x: old ? [0, 0, -4, 4, -3, 3, 0] : 0 } : {}}
      transition={old ? { duration: 2.2, times: [0, 0.45, 1], x: { delay: 1.1, duration: 0.45 } } : { duration: 0.6, ease: ease.out }}
      className="relative min-w-0 flex-1 rounded-[14px] border border-shelf bg-abyss/70 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label flex items-center gap-1.5">
          <Glyph name={side === "old" ? "document" : "correction"} size={13} className={side === "old" ? "text-glacier" : "text-sodium"} />
          {side === "old" ? "What it believed" : "What you said"}
        </p>
        <motion.span
          initial={{ opacity: 0, y: 4 }}
          animate={play ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 2.1, duration: 0.4 }}
          className={old ? "rounded-full border border-shelf px-2 py-0.5 text-[11px] text-kelp" : "rounded-full border border-rhodamine/50 px-2 py-0.5 text-[11px] text-foam"}
        >
          {old ? "outdated · kept as history" : "current"}
        </motion.span>
      </div>
      <p className="relative mt-2 w-fit text-[22px] font-[640] tracking-[-0.01em] text-foam">
        Attendance = {value}
        {old && (
          <motion.span
            className="absolute left-[-2%] top-1/2 h-[2px] w-[104%] origin-left bg-sodium"
            initial={{ scaleX: 0 }}
            animate={play ? { scaleX: 1 } : {}}
            transition={{ delay: 1.7, duration: 0.45, ease: ease.out }}
          />
        )}
      </p>
      <p className="mt-1 text-[12.5px] text-kelp">{source}</p>
      <p className="data mt-2 text-[11.5px] text-kelp">confidence {confidence}</p>

    </motion.div>
  );
}

export function Correction() {
  const ref = useRef<HTMLDivElement>(null);
  const play = useInView(ref, { once: true, margin: "-25% 0px" });
  const reduced = useReducedMotion();
  const record: [string, string][] = [
    ["Knowledge", "Attendance requirement = 80%"],
    ["Source", "User correction"],
    ["Confidence", "0.82"],
    ["Status", "Current"],
    ["Previous value", "75%"],
    ["Timestamp", TODAY],
  ];
  return (
    <div className="mx-auto grid max-w-[1320px] items-center gap-12 px-5 py-[16vh] sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <SectionHead
        eyebrow="Knowledge that evolves"
        words={[{ text: "Corrections" }, { text: "replace.", wdth: 128 }, { text: "They" }, { text: "don’t" }, { text: "pile", wdth: 66 }, { text: "up.", wdth: 66 }]}
      >
        <p>
          Storing both 75% and 80% would leave the assistant guessing. When new information collides with something it believes, it checks the
          source, marks the old value outdated and keeps it as history — so you can always see what changed, when, and on whose word.
        </p>
      </SectionHead>

      <div ref={ref} className="space-y-4">
        <div className="rounded-[18px] border border-shelf bg-trench/85 p-5 backdrop-blur-md">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <FactCard side="old" value="75%" source="Academic Regulations 2024 §3.1" confidence="0.95" old play={play || !!reduced} />
            <div className="flex shrink-0 flex-col items-center gap-1 py-1">
              <motion.span
                className="grid h-9 w-9 place-items-center rounded-full border border-sodium/60 bg-sodium/10 text-sodium"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={play ? { scale: [0.6, 1.15, 1], opacity: 1 } : {}}
                transition={{ delay: 0.55, duration: 0.6 }}
              >
                <Glyph name="correction" size={16} />
              </motion.span>
              <span className="label text-sodium">Conflict</span>
            </div>
            <FactCard side="new" value="80%" source="Your department (via you)" confidence="0.82" play={play || !!reduced} />
          </div>
          <motion.p
            className="mt-4 flex items-start gap-2 border-t hairline pt-3 text-[13px] text-kelp"
            initial={{ opacity: 0 }}
            animate={play ? { opacity: 1 } : {}}
            transition={{ delay: 1.2, duration: 0.5 }}
          >
            <Glyph name="confirm" size={14} className="mt-0.5 shrink-0 text-foam" />
            Verified: same topic, newer, more specific to you. The new value becomes current; the old one stays on record.
          </motion.p>
        </div>

        <div className="rounded-[18px] border border-shelf bg-trench/85 p-5 backdrop-blur-md">
          <p className="label mb-3">Stored as</p>
          <dl className="divide-y divide-shelf/70">
            {record.map(([k, v], i) => (
              <motion.div
                key={k}
                className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 py-2"
                initial={{ opacity: 0, x: -8 }}
                animate={play ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 2.3 + i * 0.12, duration: 0.4, ease: ease.out }}
              >
                <dt className="text-[13px] text-kelp">{k}</dt>
                <dd className="mono text-[13px] text-foam" suppressHydrationWarning>
                  {v}
                </dd>
              </motion.div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
