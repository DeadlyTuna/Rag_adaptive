"use client";

import { motion } from "motion/react";
import { Glyph } from "@/components/ui/Glyph";
import { SectionHead } from "./SectionHead";
import { useReducedMotion } from "@/lib/reduced-motion";

const NODES = ["Question", "Retrieve", "Generate answer", "Your feedback", "Evaluate retrieval", "Update memory & weights"];

function LoopDiagram() {
  const reduced = useReducedMotion();
  const R = 150;
  const C = 200;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]">
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--color-shelf)" strokeWidth={1.5} />
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke="var(--color-kelp)"
          strokeOpacity={0.5}
          strokeWidth={1.5}
          strokeDasharray="4 8"
          style={{ animation: reduced ? undefined : "dash-flow 1.2s linear infinite" }}
        />
        {!reduced && (
          <g style={{ transformOrigin: `${C}px ${C}px`, animation: "orbit 9s linear infinite" }}>
            <circle cx={C} cy={C - R} r={6} fill="var(--color-sodium)" />
            <circle cx={C} cy={C - R} r={14} fill="var(--color-sodium)" opacity={0.18} />
          </g>
        )}
      </svg>
      {NODES.map((n, i) => {
        const a = (i / NODES.length) * Math.PI * 2 - Math.PI / 2;
        const x = 50 + (Math.cos(a) * R * 100) / 400;
        const y = 50 + (Math.sin(a) * R * 100) / 400;
        const learn = i >= 3;
        return (
          <motion.span
            key={n}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.12, duration: 0.4 }}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border bg-abyss/90 px-3 py-1.5 text-[12.5px] text-foam"
            style={{ left: `${x}%`, top: `${y}%`, borderColor: learn ? "color-mix(in oklab, var(--color-rhodamine) 55%, transparent)" : "var(--color-shelf)" }}
          >
            <span className="data mr-1.5 text-[10.5px] text-kelp">{i + 1}</span>
            {n}
          </motion.span>
        );
      })}
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="label">The language model</p>
          <p className="mt-1 text-[13px] text-foam">unchanged</p>
        </div>
      </div>
    </div>
  );
}

export function Loop() {
  return (
    <div className="mx-auto grid max-w-[1320px] items-center gap-12 px-5 py-[16vh] sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <SectionHead
          eyebrow="Where the learning happens"
          words={[{ text: "The" }, { text: "model" }, { text: "stays", wdth: 70 }, { text: "the" }, { text: "same." }, { text: "Everything" }, { text: "around" }, { text: "it" }, { text: "learns.", wdth: 128 }]}
        >
          <p>
            Nothing here retrains the language model. What changes is the memory around it: which facts exist, how much each source is trusted, and how
            the four signals are weighed. Flag a bad source, and similar questions stop surfacing it.
          </p>
        </SectionHead>
        <div className="mt-8 grid max-w-[560px] gap-3 sm:grid-cols-2">
          <div className="rounded-[14px] border border-rhodamine/35 bg-trench/80 p-4 backdrop-blur-md">
            <p className="label mb-2 text-foam">Learns</p>
            <ul className="space-y-1.5 text-[13.5px] text-kelp">
              {["Memories — added, replaced, expired", "How much each source is trusted", "How the four signals are weighed"].map((t) => (
                <li key={t} className="flex gap-2">
                  <Glyph name="added" size={14} className="mt-0.5 shrink-0 text-rhodamine" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[14px] border border-shelf bg-trench/80 p-4 backdrop-blur-md">
            <p className="label mb-2 text-foam">Stays fixed</p>
            <ul className="space-y-1.5 text-[13.5px] text-kelp">
              {["The language model", "Your original documents", "What you can see and undo"].map((t) => (
                <li key={t} className="flex gap-2">
                  <Glyph name="persistent" size={14} className="mt-0.5 shrink-0 text-glacier" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <LoopDiagram />
    </div>
  );
}
