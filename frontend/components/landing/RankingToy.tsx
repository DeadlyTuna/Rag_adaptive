"use client";

// The brief's own example: four candidates for "How many marks do I need to pass?".
// Similarity alone picks the wrong regulation; the learned weights fix it.

import { LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import type { Factor, Weights } from "@/lib/engine/types";
import { FACTORS } from "@/lib/engine/types";
import { normalise } from "@/lib/engine/learn";
import { FACTOR_META } from "@/lib/factors";
import { FactorLegend, ScoreBar } from "@/components/ui/ScoreBar";
import { Glyph } from "@/components/ui/Glyph";
import { NumberTicker } from "@/components/ui/motion-bits";
import { SectionHead } from "./SectionHead";
import { cx } from "@/lib/format";
import { spring } from "@/lib/motion";

const CANDIDATES = [
  { id: "A", name: "Document A", sub: "Regulations §5.2 · Grades", kind: "document" as const, f: { S: 0.91, R: 0.1, C: 0.81, I: 0.55 }, right: false },
  { id: "B", name: "Document B", sub: "Regulations §5.1 · Passing a course", kind: "document" as const, f: { S: 0.87, R: 0.1, C: 0.95, I: 0.7 }, right: true },
  { id: "C", name: "Memory C", sub: "“Re-exam pass mark is 45” — heard from a friend", kind: "memory" as const, f: { S: 0.82, R: 0.9, C: 0.5, I: 0.6 }, right: false },
  { id: "D", name: "Document D", sub: "Regulations §4.1 · CAT marks", kind: "document" as const, f: { S: 0.79, R: 0.1, C: 0.95, I: 0.6 }, right: false },
];

const LEARNED: Weights = { S: 0.45, R: 0.15, C: 0.25, I: 0.15 };
const SIM_ONLY: Weights = { S: 0.94, R: 0.02, C: 0.02, I: 0.02 };

function rebalance(w: Weights, f: Factor, v: number): Weights {
  const value = Math.max(0.02, Math.min(0.94, v));
  const others = FACTORS.filter((g) => g !== f);
  const rest = others.reduce((s, g) => s + w[g], 0);
  const next = { ...w, [f]: value } as Weights;
  for (const g of others) next[g] = rest > 0 ? (w[g] / rest) * (1 - value) : (1 - value) / 3;
  return normalise(next);
}

export function RankingToy() {
  const [w, setW] = useState<Weights>(LEARNED);
  const scored = CANDIDATES.map((c) => ({ ...c, score: FACTORS.reduce((s, f) => s + w[f] * c.f[f], 0) })).sort((a, b) => b.score - a.score);
  const top = scored[0];

  return (
    <div className="mx-auto grid max-w-[1320px] items-center gap-12 px-5 py-[16vh] sm:px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div>
        <SectionHead
          eyebrow="Adaptive retrieval"
          words={[{ text: "Ranked" }, { text: "by" }, { text: "more", wdth: 130 }, { text: "than" }, { text: "similarity." }]}
        >
          <p>
            A passage can be close to your question and still be the wrong one to use. Each candidate is scored on four signals, and the weights are
            learned from your feedback rather than hand-tuned.
          </p>
        </SectionHead>
        <dl className="mt-7 grid max-w-[560px] gap-x-6 gap-y-3 sm:grid-cols-2">
          {FACTORS.map((f) => (
            <div key={f} className="flex gap-3">
              <span className="mt-1.5 h-2 w-3 shrink-0 rounded-[2px]" style={{ background: FACTOR_META[f].color }} />
              <div>
                <dt className="text-[14px] font-[600] text-foam">
                  <span className="mono mr-1.5 text-kelp">{f}</span>
                  {FACTOR_META[f].name}
                </dt>
                <dd className="text-[13px] text-kelp">{FACTOR_META[f].desc}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-[18px] border border-shelf bg-trench/85 p-5 backdrop-blur-md">
        <p className="mono text-[clamp(0.95rem,1.6vw,1.2rem)] text-foam">
          <span className="text-kelp">score =</span>{" "}
          {FACTORS.map((f, i) => (
            <span key={f}>
              {i > 0 && <span className="text-kelp"> + </span>}
              <NumberTicker value={w[f]} format={(n) => n.toFixed(2)} />
              <span className="text-kelp">·</span>
              <span className="underline decoration-2 underline-offset-4" style={{ textDecorationColor: FACTOR_META[f].color }}>
                {f}
              </span>
            </span>
          ))}
        </p>

        <div className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {FACTORS.map((f) => (
            <label key={f} className="block">
              <span className="mb-0.5 flex items-baseline justify-between text-[12.5px]">
                <span className="text-kelp">{FACTOR_META[f].name}</span>
                <span className="data text-foam">{w[f].toFixed(2)}</span>
              </span>
              <input
                type="range"
                className="range"
                min={0.02}
                max={0.94}
                step={0.01}
                value={w[f]}
                onChange={(e) => setW((cur) => rebalance(cur, f, Number(e.target.value)))}
                style={{ ["--c" as string]: FACTOR_META[f].color, ["--p" as string]: `${((w[f] - 0.02) / 0.92) * 100}%` }}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setW(SIM_ONLY)}
            className="rounded-full border border-shelf px-3 py-1.5 text-[12.5px] text-kelp transition-colors hover:border-kelp/60 hover:text-foam"
          >
            Similarity only
          </button>
          <button
            type="button"
            onClick={() => setW(LEARNED)}
            className="rounded-full border border-shelf px-3 py-1.5 text-[12.5px] text-kelp transition-colors hover:border-kelp/60 hover:text-foam"
          >
            Learned weights
          </button>
        </div>

        <div className="mt-5 border-t hairline pt-4">
          <p className="mb-2 text-[13px] text-kelp">
            For <span className="text-foam">“How many marks do I need to pass?”</span>
          </p>
          <FactorLegend className="mb-2" />
          <LayoutGroup>
            <ol className="space-y-1">
              {scored.map((c, i) => (
                <motion.li
                  key={c.id}
                  layout
                  transition={spring.fluid}
                  className={cx(
                    "grid grid-cols-[22px_minmax(0,1fr)_minmax(110px,36%)_44px] items-center gap-3 rounded-[10px] px-2.5 py-2",
                    i === 0 && "bg-reef/70",
                  )}
                >
                  <span className="data text-foam">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13px] font-[600] text-foam">
                      <Glyph name={c.kind === "document" ? "document" : "memory"} size={13} className={c.kind === "document" ? "text-glacier" : "text-rhodamine"} />
                      {c.name}
                      <span className="data text-[10.5px] font-[400] text-kelp">S {c.f.S.toFixed(2)}</span>
                    </span>
                    <span className="block truncate text-[11.5px] text-kelp">{c.sub}</span>
                  </span>
                  <ScoreBar factors={c.f} weights={w} />
                  <span className="data text-right text-foam">{c.score.toFixed(2)}</span>
                </motion.li>
              ))}
            </ol>
          </LayoutGroup>
          <motion.p
            key={top.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex items-center gap-2 text-[13px] text-kelp"
          >
            <Glyph name={top.right ? "confirm" : "flag"} size={14} className={top.right ? "text-foam" : "text-flare"} />
            {top.right
              ? "The right regulation wins — confidence and importance outweigh a slightly higher similarity."
              : `${top.name} wins on similarity alone — and it’s the wrong source for this question.`}
          </motion.p>
        </div>
      </div>
    </div>
  );
}
