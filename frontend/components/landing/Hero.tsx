"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowDown } from "lucide-react";
import { DisplayText } from "@/components/ui/motion-bits";
import { ButtonLink } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { cx } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

// The hero story, step by step (durations in ms). Step 4 is the correction landing.
const STEPS = [700, 1500, 1500, 1700, 1700, 1500, 1500, 5200];
const CORRECTED_AT = 4;

function Typed({ text, active }: { text: string; active: boolean }) {
  const reduced = useReducedMotion();
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (!active || reduced) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= text.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [active, text, reduced]);
  const n = reduced ? text.length : typed;
  return (
    <span className="mono">
      {text.slice(0, n)}
      {n < text.length && <span className="ml-px inline-block h-[1em] w-[0.5ch] translate-y-[2px] bg-sodium" />}
    </span>
  );
}

function Line({ who, children, show }: { who: "You" | "RAG"; children: React.ReactNode; show: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          layout
          initial={{ opacity: 0, y: 8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: ease.out }}
          className="grid grid-cols-[38px_minmax(0,1fr)] gap-2 overflow-hidden"
        >
          <span className={cx("label pt-[3px]", who === "RAG" ? "text-rhodamine" : "text-foam")}>{who}</span>
          <div className="pb-2.5 text-[13.5px] leading-relaxed text-foam">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function HeroDemo({ onCorrected }: { onCorrected: (v: boolean) => void }) {
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(0);
  const [cycle, setCycle] = useState(0);
  // reduced motion: show the finished story, no loop
  const step = reduced ? STEPS.length - 1 : playing;

  useEffect(() => {
    if (reduced) return;
    const id = setTimeout(() => {
      if (playing >= STEPS.length - 1) {
        setPlaying(0);
        setCycle((c) => c + 1);
      } else setPlaying(playing + 1);
    }, STEPS[playing]);
    return () => clearTimeout(id);
  }, [playing, reduced]);

  useEffect(() => onCorrected(step >= CORRECTED_AT), [step, onCorrected]);

  const corrected = step >= CORRECTED_AT;
  return (
    <div className="relative w-full max-w-[440px] overflow-hidden rounded-[20px] border border-shelf/90 bg-trench/75 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.75)] backdrop-blur-xl">
      {/* the fact itself, written over */}
      <div className="border-b hairline px-5 pb-4 pt-4">
        <div className="flex items-center justify-between">
          <p className="label">Minimum attendance</p>
          <p className="data text-[10.5px] text-kelp">live demo</p>
        </div>
        <div className="mt-2 flex items-end gap-4">
          <div className="relative mt-3 h-[76px] w-[176px] font-display text-[66px] leading-none font-[760] tracking-[-0.04em]" style={{ ["--wdth" as string]: 86 }}>
            <AnimatePresence initial={false} mode="popLayout">
              {!corrected ? (
                <motion.span
                  key={`75-${cycle}`}
                  className="absolute left-0 top-0 text-foam"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  75%
                </motion.span>
              ) : (
                <motion.span key={`80-${cycle}`} className="absolute left-0 top-0" initial={false}>
                  {/* the ghost of the old value, struck */}
                  <motion.span
                    className="absolute left-0 top-0 text-kelp/30"
                    initial={{ x: 0, y: 0 }}
                    animate={{ x: 96, y: -6, scale: 0.42 }}
                    style={{ transformOrigin: "left top" }}
                    transition={{ delay: 0.45, duration: 0.7, ease: ease.inOut }}
                  >
                    75%
                    <motion.span
                      className="absolute left-[-3%] top-[52%] h-[5px] w-[106%] origin-left rounded-full bg-sodium"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.4, ease: ease.out }}
                    />
                  </motion.span>
                  <motion.span
                    className="relative inline-block text-foam"
                    style={{ ["--wdth" as string]: 112 }}
                    initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 6, filter: "blur(0px)" }}
                    transition={{ delay: 0.75, duration: 0.6, ease: ease.out }}
                  >
                    80%
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="pb-2 text-[12px] leading-snug text-kelp">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={corrected ? "c" : "d"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                {corrected ? (
                  <>
                    <span className="flex items-center gap-1.5 text-foam">
                      <Glyph name="correction" size={13} className="text-sodium" /> Your department
                    </span>
                    confidence 0.82 · replaces 75%
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-foam">
                      <Glyph name="document" size={13} className="text-glacier" /> Regulations §3.1
                    </span>
                    Academic Regulations 2024
                  </>
                )}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* the conversation that changed it */}
      <div key={cycle} className="min-h-[214px] px-5 pb-2 pt-4">
        <Line who="You" show={step >= 1}>
          <Typed text="What's the minimum attendance?" active={step >= 1} />
        </Line>
        <Line who="RAG" show={step >= 2}>
          75%, from Regulations §3.1.
        </Line>
        <Line who="You" show={step >= 3}>
          <Typed text="Our department changed it to 80%." active={step >= 3} />
          {step >= CORRECTED_AT && (
            <motion.span
              initial={{ opacity: 0, y: 4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={spring.snap}
              className="mt-1.5 flex w-fit items-center gap-1.5 rounded-full border border-sodium/40 px-2 py-0.5 text-[11.5px] text-foam"
            >
              <Glyph name="correction" size={12} className="text-sodium" /> Correction 0.89 · replaces 75%
            </motion.span>
          )}
        </Line>
        <Line who="You" show={step >= 5}>
          <Typed text="So when can I write my FAT?" active={step >= 5} />
        </Line>
        <Line who="RAG" show={step >= 6}>
          With at least <span className="font-[620]">80%</span> attendance — your department’s rule, not the university’s 75%.
        </Line>
      </div>
    </div>
  );
}

export function Hero({ onCorrected }: { onCorrected: (v: boolean) => void }) {
  return (
    <div className="mx-auto grid min-h-[100svh] max-w-[1320px] items-center gap-10 px-5 pb-[18vh] pt-28 sm:px-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-14 lg:pt-24">
      <div>
        <motion.p
          className="label"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          Adaptive retrieval-augmented generation
        </motion.p>
        <DisplayText
          className="mt-5 font-display text-[clamp(3rem,6.1vw,6rem)] font-[760] leading-[0.92] tracking-[-0.035em] text-foam"
          delay={0.35}
          lines={[
            [{ text: "Correct", wdth: 84 }, { text: "it", wdth: 84 }, { text: "once.", wdth: 116 }],
            [{ text: "It", wdth: 84 }, { text: "remembers.", wdth: 104, className: "text-rhodamine" }],
          ]}
        />
        <motion.p
          className="t-body-l mt-7 max-w-[560px] text-kelp"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.95, duration: 0.7, ease: ease.out }}
        >
          Adaptive RAG answers from your documents <em className="not-italic text-foam">and</em> from what it learns in conversation. Correct a fact
          and it retires the old one, keeps the new one, and ranks it higher next time — without retraining the model.
        </motion.p>
        <motion.div
          className="mt-9 flex flex-wrap items-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.7, ease: ease.out }}
        >
          <ButtonLink href="/console" variant="primary" size="lg">
            Open the console
          </ButtonLink>
          <a href="#problem" className="group inline-flex h-12 items-center gap-2 rounded-full px-4 text-[15px] font-[560] text-kelp transition-colors hover:text-foam">
            See how it learns
            <ArrowDown size={16} className="transition-transform duration-300 group-hover:translate-y-0.5" />
          </a>
        </motion.div>
      </div>
      <motion.div
        className="flex justify-center lg:justify-end"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 1.25, duration: 0.9, ease: ease.out }}
      >
        <HeroDemo onCorrected={onCorrected} />
      </motion.div>
    </div>
  );
}
