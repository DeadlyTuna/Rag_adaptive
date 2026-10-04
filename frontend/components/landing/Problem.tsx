"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { Glyph } from "@/components/ui/Glyph";
import { SectionHead } from "./SectionHead";
import { cx } from "@/lib/format";
import { ease } from "@/lib/motion";
import { useReducedMotion } from "@/lib/reduced-motion";

const PIPE = ["Your PDF", "Chunks", "Embeddings", "Vector DB", "Search", "LLM", "Answer"];

function Pipeline() {
  const reduced = useReducedMotion();
  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:items-center" aria-label="The ordinary RAG pipeline">
      {PIPE.map((p, i) => (
        <li key={p} className="flex items-center sm:flex-1 sm:flex-row flex-col">
          <span className="mono w-full whitespace-nowrap rounded-[9px] border border-shelf bg-abyss/70 px-2.5 py-2 text-center text-[11.5px] text-foam sm:w-auto">
            {p}
          </span>
          {i < PIPE.length - 1 && (
            <span className="relative mx-auto h-5 w-px bg-shelf sm:mx-1 sm:h-px sm:w-auto sm:flex-1">
              {!reduced && (
                <span
                  className="absolute h-1.5 w-1.5 rounded-full bg-glacier [animation:packet-v_1.8s_linear_infinite] sm:[animation:packet-h_1.8s_linear_infinite]"
                  style={{ animationDelay: `${i * 0.25}s` }}
                />
              )}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

const STALE = [
  { who: "You", text: "What's the attendance requirement?" },
  { who: "RAG", text: "75%." },
  { who: "You", text: "Actually, our department changed that rule last semester." },
  { who: "RAG", text: "Okay." },
  { who: "You", text: "So what's my attendance requirement?" },
  { who: "RAG", text: "75%.", stale: true },
];

function Stale() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  return (
    <div ref={ref} className="space-y-2">
      {STALE.map((m, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.15 + i * 0.35, duration: 0.45, ease: ease.out }}
          className="grid grid-cols-[40px_minmax(0,1fr)] gap-2"
        >
          <span className={cx("label pt-[3px]", m.who === "RAG" ? "text-glacier" : "text-foam")}>{m.who}</span>
          <div className="text-[14px] text-foam">
            <span className={cx(m.stale && "rounded-[4px] bg-flare/10 px-1 underline decoration-flare decoration-wavy underline-offset-4")}>{m.text}</span>
            {m.stale && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={inView ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.15 + i * 0.35 + 0.4, duration: 0.4 }}
                className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-flare/40 px-2 py-0.5 text-[11.5px] text-foam"
              >
                <Glyph name="flag" size={12} className="text-flare" /> Still quoting the PDF — the correction went nowhere
              </motion.span>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function Problem() {
  return (
    <div className="mx-auto grid max-w-[1320px] items-center gap-12 px-5 py-[16vh] sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <SectionHead
        eyebrow="The problem"
        words={[
          { text: "Ordinary" },
          { text: "RAG" },
          { text: "answers" },
          { text: "from" },
          { text: "a" },
          { text: "frozen", wdth: 62 },
          { text: "page." },
        ]}
      >
        <p>
          Retrieval-augmented generation looks up passages in your documents and hands them to a language model. That works until a rule changes.
        </p>
        <p>
          Tell a plain RAG system your department raised attendance to 80%, and the next answer still quotes the 75% in the PDF. Nothing in the
          pipeline was listening.
        </p>
      </SectionHead>
      <div className="space-y-5">
        <div className="rounded-[18px] border border-shelf bg-trench/80 p-5 backdrop-blur-md">
          <p className="label mb-4">The usual pipeline</p>
          <Pipeline />
        </div>
        <div className="rounded-[18px] border border-shelf bg-trench/80 p-5 backdrop-blur-md">
          <p className="label mb-4">What that feels like</p>
          <Stale />
        </div>
      </div>
    </div>
  );
}
