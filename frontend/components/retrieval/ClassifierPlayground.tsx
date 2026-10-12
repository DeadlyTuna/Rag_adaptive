"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Classification, MemoryClass } from "@/lib/engine/types";
import { CLASSES } from "@/lib/engine/types";
import { classify } from "@/lib/engine/classify";
import { createWorld } from "@/lib/engine/seed";
import { EVAL_SET } from "@/lib/engine/evalset";
import { ProbabilityBars } from "@/components/console/ClassifierStrip";
import { CLASS_LABEL, Glyph } from "@/components/ui/Glyph";
import { Segmented } from "@/components/ui/Segmented";
import { cx } from "@/lib/format";
import { useStore } from "@/lib/store";
import { LIVE, live } from "@/lib/api/live";
import type { ClassifierEval } from "@/lib/api/live";

type Predictor = "rules" | "ml";

interface EvalView {
  m: Record<MemoryClass, Record<MemoryClass, number>>;
  accuracy: number;
  macroF1: number;
  misses: { text: string; actual: MemoryClass; predicted: MemoryClass }[];
  n: number;
}

const EXAMPLES = [
  "My name is Harsh.",
  "I prefer concise answers.",
  "I have an exam tomorrow.",
  "What's 2+2?",
  "The professor changed the deadline.",
  "Actually, your previous answer was wrong.",
];

function emptyMatrix() {
  return Object.fromEntries(CLASSES.map((a) => [a, Object.fromEntries(CLASSES.map((b) => [b, 0]))])) as Record<MemoryClass, Record<MemoryClass, number>>;
}

/** The backend's confusion[][] (rows = true, in `classes` order) → this component's shape. */
function fromServer(r: ClassifierEval): EvalView {
  const m = emptyMatrix();
  r.classes.forEach((a, i) => r.classes.forEach((b, j) => (m[a][b] = r.confusion[i]?.[j] ?? 0)));
  return {
    m,
    accuracy: r.accuracy,
    macroF1: r.macroF1,
    misses: r.misses.map((x) => ({ text: x.text, actual: x.expected, predicted: x.got })),
    n: r.total,
  };
}

function evaluate(): EvalView {
  const w = createWorld(Date.now());
  const m: Record<MemoryClass, Record<MemoryClass, number>> = Object.fromEntries(
    CLASSES.map((a) => [a, Object.fromEntries(CLASSES.map((b) => [b, 0]))]),
  ) as Record<MemoryClass, Record<MemoryClass, number>>;
  const misses: { text: string; actual: MemoryClass; predicted: MemoryClass }[] = [];
  for (const e of EVAL_SET) {
    const p = classify(e.text, { world: w }).label;
    m[e.label][p]++;
    if (p !== e.label) misses.push({ text: e.text, actual: e.label, predicted: p });
  }
  const correct = CLASSES.reduce((s, c) => s + m[c][c], 0);
  const f1s = CLASSES.map((c) => {
    const tp = m[c][c];
    const fp = CLASSES.reduce((s, a) => s + (a !== c ? m[a][c] : 0), 0);
    const fn = CLASSES.reduce((s, p) => s + (p !== c ? m[c][p] : 0), 0);
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  });
  return { m, accuracy: correct / EVAL_SET.length, macroF1: f1s.reduce((a, b) => a + b, 0) / f1s.length, misses, n: EVAL_SET.length };
}

function ConfusionMatrix({ predictor }: { predictor: Predictor }) {
  const local = useMemo(() => (LIVE ? null : evaluate()), []);
  const [server, setServer] = useState<{ predictor: Predictor; view: EvalView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!LIVE) return;
    let stale = false;
    live
      .classifierEval(predictor)
      .then((r) => {
        if (stale) return;
        setServer({ predictor, view: fromServer(r) });
        setError(null);
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stale = true;
    };
  }, [predictor]);
  const r = LIVE ? (server?.predictor === predictor ? server.view : null) : local;
  if (!r) {
    return (
      <p className="text-[12.5px] text-kelp" aria-busy={!error}>
        {error ? `Couldn’t load the evaluation: ${error}` : "Scoring the held-out sentences…"}
      </p>
    );
  }
  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-[600] text-foam">How well it classifies</span>
        <span className="text-[12px] text-kelp">
          {r.n} hand-labelled sentences · accuracy <span className="data text-foam">{(r.accuracy * 100).toFixed(1)}%</span> · macro-F1{" "}
          <span className="data text-foam">{r.macroF1.toFixed(2)}</span>
        </span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-[3px] text-center">
          <caption className="sr-only">Confusion matrix: rows are the true class, columns the predicted class.</caption>
          <thead>
            <tr>
              <th className="label text-left font-[500]">True ↓ / predicted →</th>
              {CLASSES.map((c) => (
                <th key={c} scope="col" className="pb-1 text-[11px] font-[500] text-kelp">
                  {CLASS_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CLASSES.map((a) => {
              const total = CLASSES.reduce((s, b) => s + r.m[a][b], 0) || 1;
              return (
                <tr key={a}>
                  <th scope="row" className="pr-2 text-left text-[12px] font-[500] text-kelp">
                    {CLASS_LABEL[a]}
                  </th>
                  {CLASSES.map((b) => {
                    const v = r.m[a][b];
                    const p = v / total;
                    return (
                      <td
                        key={b}
                        className={cx("data h-10 rounded-[6px] text-[12.5px]", p > 0.55 ? "font-[620] text-abyss" : v ? "text-foam" : "text-kelp/50")}
                        style={{ background: `color-mix(in oklab, var(--color-glacier) ${Math.round(p * 92)}%, var(--color-abyss))` }}
                        title={`${CLASS_LABEL[a]} predicted as ${CLASS_LABEL[b]}: ${v}`}
                      >
                        {v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {r.misses.length > 0 && (
        <p className="mt-3 text-[12px] text-kelp">
          Misses:{" "}
          {r.misses.map((x, i) => (
            <span key={i}>
              “{x.text}” ({CLASS_LABEL[x.actual].toLowerCase()} → {CLASS_LABEL[x.predicted].toLowerCase()}){i < r.misses.length - 1 ? "; " : ""}
            </span>
          ))}
          {LIVE ? "." : ". The real backend can swap in an LLM classifier and be scored on the same set."}
        </p>
      )}
    </figure>
  );
}

export function ClassifierPlayground() {
  const world = useStore((s) => s.world);
  const [text, setText] = useState("Our department changed the attendance rule to 80%.");
  const q = useDeferredValue(text);
  const [predictor, setPredictor] = useState<Predictor>("ml");
  const local = useMemo(() => (!LIVE && q.trim() ? classify(q, { world }) : null), [q, world]);
  const [server, setServer] = useState<{ key: string; c: Classification } | null>(null);
  const key = `${predictor}:${q.trim()}`;
  useEffect(() => {
    if (!LIVE || !q.trim()) return;
    let stale = false;
    const t = setTimeout(() => {
      live
        .classify(q.trim(), predictor)
        .then((c) => !stale && setServer({ key, c }))
        .catch(() => undefined);
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, predictor, key, world.memories.length, world.events.length]);
  const c = LIVE ? (server?.key === key ? server.c : null) : local;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <label htmlFor="cls-input" className="text-[13px] font-[600] text-foam">
          Try a sentence
        </label>
        <p className="mt-0.5 text-[12.5px] text-kelp">Classified against what it currently knows — nothing is stored from here.</p>
        <input
          id="cls-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-3 h-11 w-full rounded-[10px] border border-shelf bg-abyss/60 px-3.5 text-[14.5px] text-foam outline-none transition-colors placeholder:text-kelp focus:border-kelp/60"
          placeholder="Type something a student might say"
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setText(e)}
              className={cx(
                "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                text === e ? "border-kelp/60 text-foam" : "border-shelf text-kelp hover:border-kelp/50 hover:text-foam",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        {c && (
          <div className="mt-4 rounded-[12px] border border-shelf bg-abyss/40 p-3.5">
            <ProbabilityBars c={c} />
            <div className="mt-3 space-y-1.5 border-t hairline pt-3 text-[12.5px] text-kelp">
              {c.slotLabel && (
                <p>
                  Topic: <span className="text-foam">{c.slotLabel}</span>
                  {c.value && (
                    <>
                      {" "}
                      · value <span className="data text-foam">{c.value}</span>
                    </>
                  )}
                </p>
              )}
              {c.conflict && (
                <p className="flex gap-2">
                  <Glyph name="correction" size={13} className="mt-0.5 shrink-0 text-sodium" />
                  <span>
                    Conflicts with <span className="text-foam">“{c.conflict.withText}”</span> ({c.conflict.withSource})
                  </span>
                </p>
              )}
              <p>→ {c.reason}</p>
            </div>
          </div>
        )}
      </div>
      <div>
        {LIVE && (
          <div className="mb-3">
            <Segmented
              label="Classifier"
              value={predictor}
              onChange={setPredictor}
              options={[
                { value: "rules", label: "Rules", hint: "Cue-word scorer" },
                { value: "ml", label: "Trained model", hint: "TF-IDF + logistic regression" },
              ]}
            />
          </div>
        )}
        <ConfusionMatrix predictor={predictor} />
      </div>
    </div>
  );
}
