"use client";

// Scroll-driven: the brief's six statements are classified one by one and slide
// into the lane that decides their fate. Real classifier output.

import { AnimatePresence, LayoutGroup, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MemoryClass } from "@/lib/engine/types";
import { CLASSES } from "@/lib/engine/types";
import { classify } from "@/lib/engine/classify";
import { createWorld } from "@/lib/engine/seed";
import { ProbabilityBars } from "@/components/console/ClassifierStrip";
import { Glyph, CLASS_LABEL } from "@/components/ui/Glyph";
import { SectionHead } from "./SectionHead";
import { cx } from "@/lib/format";
import { spring } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

const STATEMENTS = [
  "My name is Harsh.",
  "I prefer concise answers.",
  "I have an exam tomorrow.",
  "What's 2+2?",
  "The professor changed the deadline.",
  "Actually, your previous answer was wrong.",
];

const PRISTINE_NOW = Date.now();

const LANE: Record<MemoryClass, { outcome: string; tone: string }> = {
  persistent: { outcome: "Kept long-term", tone: "text-rhodamine" },
  important: { outcome: "Kept with high priority", tone: "text-rhodamine" },
  correction: { outcome: "Replaces or flags what it believed", tone: "text-sodium" },
  temporary: { outcome: "Kept until it stops mattering", tone: "text-rhodamine" },
  irrelevant: { outcome: "Not stored", tone: "text-kelp" },
};

function useDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const on = () => setD(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return d;
}

export function Sorter({ onSorted }: { onSorted: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const desktop = useDesktop();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [progressK, setProgressK] = useState(0);
  const items = useMemo(() => {
    const w = createWorld(PRISTINE_NOW);
    return STATEMENTS.map((text) => ({ text, c: classify(text, { world: w }) }));
  }, []);

  const sticky = desktop && !reduced;
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    setProgressK(Math.max(0, Math.min(STATEMENTS.length, Math.floor(p * (STATEMENTS.length + 1.4)))));
  });
  // sticky (desktop): scroll progress drives it; otherwise everything is shown sorted
  const k = sticky ? progressK : STATEMENTS.length;
  useEffect(() => onSorted(k), [k, onSorted]);

  const current = k < items.length ? items[k] : null;

  const visual = (
    <LayoutGroup>
      <div className="rounded-[18px] border border-shelf bg-trench/85 p-5 backdrop-blur-md">
        <div className="mb-4 min-h-[188px]">
          <p className="label mb-2.5">{current ? `Now classifying · ${k + 1} of ${items.length}` : "All six sorted"}</p>
          <AnimatePresence mode="popLayout">
            {current ? (
              <motion.div key={current.text} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <motion.p layoutId={`st-${current.text}`} transition={spring.fluid} className="mono mb-3 w-fit rounded-[10px] border border-sodium/50 bg-abyss/60 px-3 py-2 text-[14px] text-foam">
                  “{current.text}”
                </motion.p>
                <ProbabilityBars c={current.c} />
              </motion.div>
            ) : (
              <motion.p key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[14px] text-kelp">
                Four of six are kept in some form. Only the small talk is dropped — and the correction changes what it believed.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <ul className="divide-y divide-shelf/70 border-t hairline">
          {CLASSES.map((cls) => {
            const lane = items.slice(0, k).filter((it) => it.c.label === cls);
            return (
              <li key={cls} className="grid min-h-[58px] grid-cols-[150px_minmax(0,1fr)] items-center gap-3 py-2.5 sm:grid-cols-[190px_minmax(0,1fr)]">
                <span>
                  <span className="flex items-center gap-2 text-[13px] font-[600] text-foam">
                    <Glyph name={cls} size={14} className={LANE[cls].tone} />
                    {CLASS_LABEL[cls]}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-kelp">{LANE[cls].outcome}</span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {lane.map((it) => (
                    <motion.span
                      key={it.text}
                      layoutId={`st-${it.text}`}
                      transition={spring.fluid}
                      className={cx(
                        "inline-flex items-center gap-2 rounded-[9px] border bg-abyss/60 px-2.5 py-1.5 text-[12.5px] text-foam",
                        cls === "irrelevant" ? "border-shelf/70 text-kelp line-through decoration-kelp/40" : "border-shelf",
                      )}
                    >
                      {it.text}
                      <span className="data text-[10.5px] text-kelp no-underline">{it.c.probs[cls].toFixed(2)}</span>
                    </motion.span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </LayoutGroup>
  );

  const head = (
    <SectionHead
      eyebrow="What it keeps"
      words={[{ text: "It" }, { text: "decides" }, { text: "what’s" }, { text: "worth" }, { text: "remembering.", wdth: 110 }]}
    >
      <p>
        Every message passes through a memory classifier before it’s answered. Most of what people say should be forgotten. A few things — who you
        are, how you like answers, rules that changed — are worth keeping, each for as long as it stays true.
      </p>
      {sticky && <p className="text-[13px] text-kelp/80">Keep scrolling to classify the next sentence.</p>}
    </SectionHead>
  );

  if (!sticky) {
    return (
      <div ref={ref} className="mx-auto grid max-w-[1320px] items-center gap-10 px-5 py-[14vh] sm:px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        {head}
        {visual}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative h-[280vh]">
      <div className="sticky top-0 flex min-h-[100svh] items-center">
        <div className="mx-auto grid w-full max-w-[1320px] items-center gap-12 px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          {head}
          {visual}
        </div>
      </div>
    </div>
  );
}
