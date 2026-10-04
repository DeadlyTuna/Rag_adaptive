"use client";

// A document becoming searchable: it fractures into chunks, each chunk gets its
// embedding fingerprint, then the pieces drop into the index.

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { SeedDocument } from "@/lib/engine/corpus";
import { Glyph } from "@/components/ui/Glyph";
import { Fingerprint } from "./Fingerprint";
import { ease, spring } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

type Phase = "split" | "embed" | "index" | "done";

const PHASE_TEXT: Record<Phase, string> = {
  split: "Splitting into passages",
  embed: "Embedding each passage",
  index: "Adding to the index",
  done: "Indexed",
};

export function IngestSequence({ doc, onIndexed, onFinished }: { doc: SeedDocument; onIndexed: () => void; onFinished: () => void }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("split");
  const n = doc.sections.length;

  useEffect(() => {
    const k = reduced ? 0.3 : 1;
    const t1 = setTimeout(() => setPhase("embed"), (500 + n * 110) * k);
    const t2 = setTimeout(() => setPhase("index"), (1300 + n * 160) * k);
    const t3 = setTimeout(() => {
      setPhase("done");
      onIndexed();
    }, (2000 + n * 170) * k);
    const t4 = setTimeout(onFinished, (3400 + n * 170) * k);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-[14px] border border-shelf bg-abyss/50 p-4" aria-live="polite">
      <div className="mb-3 flex items-center gap-2.5">
        <Glyph name="document" className="text-glacier" />
        <p className="min-w-0 flex-1 truncate text-[14px] font-[600] text-foam">{doc.title}</p>
        <AnimatePresence mode="wait">
          <motion.p
            key={phase}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 text-[12.5px] text-kelp"
          >
            {phase !== "done" ? <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-sodium" /> : <Glyph name="confirm" size={13} className="text-glacier" />}
            {phase === "done" ? `${PHASE_TEXT.done} · ${n} passages` : `${PHASE_TEXT[phase]}…`}
          </motion.p>
        </AnimatePresence>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {doc.sections.map((s, i) => (
          <motion.li
            key={s.section}
            initial={reduced ? false : { opacity: 0, scale: 0.86, y: -10, rotate: (i % 2 ? 1 : -1) * 3 }}
            animate={
              phase === "done"
                ? { opacity: 0.55, scale: 0.98, y: 6, rotate: 0 }
                : { opacity: 1, scale: 1, y: 0, rotate: 0 }
            }
            transition={phase === "done" ? { duration: 0.6, ease: ease.inOut, delay: i * 0.05 } : { ...spring.snap, delay: 0.15 + i * 0.11 }}
            className="rounded-[10px] border border-shelf bg-trench px-3 py-2.5"
          >
            <p className="flex items-baseline gap-2">
              <span className="data text-[11px] text-kelp">§{s.section}</span>
              <span className="truncate text-[12.5px] font-[560] text-foam">{s.title}</span>
            </p>
            <p className="mt-1 line-clamp-2 text-[11.5px] text-kelp">{s.text}</p>
            <div className="mt-2 h-3">
              {phase !== "split" && <Fingerprint text={`${s.title}. ${s.text}`} animate delay={i * 0.08} />}
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
