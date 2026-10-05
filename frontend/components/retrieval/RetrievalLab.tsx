"use client";

import { LayoutGroup, motion } from "motion/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Candidate, Factor, Weights } from "@/lib/engine/types";
import { FACTORS } from "@/lib/engine/types";
import { rankAll, scoreOf } from "@/lib/engine/retrieve";
import { LIVE, live } from "@/lib/api/live";
import { expandQuery } from "@/lib/engine/engine";
import { isQuestion } from "@/lib/engine/text";
import type { Classification } from "@/lib/engine/types";
import { normalise } from "@/lib/engine/learn";
import { FACTOR_META } from "@/lib/factors";
import { Panel, Empty } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { NumberTicker, Meter } from "@/components/ui/motion-bits";
import { FactorLegend, ScoreBar } from "@/components/ui/ScoreBar";
import { LearningCurve } from "./LearningCurve";
import { ClassifierPlayground } from "./ClassifierPlayground";
import { chunkLabel } from "@/lib/selectors";
import { cx } from "@/lib/format";
import { spring } from "@/lib/motion";
import { useHydrated, useNow, useStore } from "@/lib/store";

const QUERIES = [
  "When can I write my FAT?",
  "What is the minimum attendance requirement?",
  "How many marks do I need to pass?",
  "When does the library close?",
  "Can I get condonation for medical leave?",
];

function rebalance(w: Weights, f: Factor, v: number): Weights {
  const value = Math.max(0.02, Math.min(0.9, v));
  const others = FACTORS.filter((g) => g !== f);
  const rest = others.reduce((s, g) => s + w[g], 0);
  const next = { ...w, [f]: value } as Weights;
  for (const g of others) next[g] = rest > 0 ? (w[g] / rest) * (1 - value) : (1 - value) / 3;
  return normalise(next);
}

/** Live mode: the server scores every source once per query; the weights are applied here. */
function useServerCandidates(query: string, version: string) {
  const [res, setRes] = useState<{ asked: string; query: string; candidates: Candidate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!LIVE || !query.trim()) return;
    let stale = false;
    const t = setTimeout(() => {
      live
        .retrieve(query)
        .then((r) => {
          if (stale) return;
          setRes({ ...r, asked: query });
          setError(null);
        })
        .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, version]);
  // only ever show the ranking for the question currently in the box
  return { res: res && res.asked === query && query.trim() ? res : null, error };
}

function rescore(cands: Candidate[], w: Weights): Candidate[] {
  return cands
    .map((c) => ({ ...c, score: Math.round(scoreOf(c.factors, w) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

function Formula({ w }: { w: Weights }) {
  return (
    <p className="mono flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[clamp(1rem,1.8vw,1.35rem)] text-foam" aria-label={`score equals ${FACTORS.map((f) => `${w[f].toFixed(2)} times ${FACTOR_META[f].name}`).join(" plus ")}`}>
      <span className="text-kelp">score =</span>
      {FACTORS.map((f, i) => (
        <span key={f} className="inline-flex items-baseline gap-1">
          {i > 0 && <span className="mr-1 text-kelp">+</span>}
          <NumberTicker value={w[f]} format={(n) => n.toFixed(2)} className="tnum" />
          <span className="text-kelp">·</span>
          <span className="relative">
            {f}
            <span className="absolute -bottom-1 left-0 h-[2px] w-full rounded" style={{ background: FACTOR_META[f].color }} />
          </span>
        </span>
      ))}
    </p>
  );
}

function Row({ c, weights, delta, i }: { c: Candidate; weights: Weights; delta: number; i: number }) {
  const open = useStore((s) => s.openMemory);
  return (
    <motion.li layout transition={spring.fluid} className="relative">
      <button
        type="button"
        onClick={() => open(c.id)}
        className="grid w-full grid-cols-[26px_minmax(0,1fr)_minmax(120px,38%)_52px] items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-left transition-colors hover:bg-reef/60"
      >
        <span className="data text-[13px] text-foam">{i + 1}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <Glyph name={c.kind === "document" ? "document" : "memory"} size={13} className={c.kind === "document" ? "text-glacier" : "text-rhodamine"} />
            <span className="truncate text-[13px] font-[560] text-foam">{c.title}</span>
          </span>
          <span className="block truncate text-[11.5px] text-kelp">{c.subtitle}</span>
        </span>
        <ScoreBar factors={c.factors} weights={weights} />
        <span className="flex items-center justify-end gap-1.5">
          {delta !== 0 && (
            <motion.span
              key={delta}
              initial={{ opacity: 0, y: delta > 0 ? 6 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="data text-[10.5px] text-kelp"
              aria-label={delta > 0 ? `up ${delta}` : `down ${-delta}`}
            >
              {delta > 0 ? `▲${delta}` : `▼${-delta}`}
            </motion.span>
          )}
          <span className="data text-[12.5px] text-foam">{c.score.toFixed(2)}</span>
        </span>
      </button>
    </motion.li>
  );
}

export function RetrievalLab() {
  const hydrated = useHydrated();
  const world = useStore((s) => s.world);
  const setWeights = useStore((s) => s.setWeights);
  const now = useNow(60_000);
  const [mode, setMode] = useState<"learned" | "manual">("learned");
  const [manual, setManual] = useState<Weights>(world.weights);
  const [query, setQuery] = useState(QUERIES[0]);
  const [showTable, setShowTable] = useState(false);
  const raw = useDeferredValue(query);
  // same query processing as the console: questions get context terms added
  const localQ = useMemo(() => expandQuery(raw, { isQuestion: isQuestion(raw) } as Classification), [raw]);
  // any change to the world adds an event, so this refetches when sources or trust change
  const server = useServerCandidates(raw, `${world.events.length}:${world.memories.length}:${world.chunks.length}`);
  const q = LIVE ? (server.res?.query ?? raw) : localQ;

  const weights = mode === "learned" ? world.weights : manual;
  const learnedRank = useMemo(
    () => (LIVE ? rescore(server.res?.candidates ?? [], world.weights) : rankAll(world, q, world.weights, now)),
    [world, q, now, server.res],
  );
  const ranked = useMemo(
    () => (LIVE ? rescore(server.res?.candidates ?? [], weights) : rankAll(world, q, weights, now)).slice(0, 8),
    [world, q, weights, now, server.res],
  );
  const before = new Map(learnedRank.map((c, i) => [c.id, i]));

  const unreliable = useMemo(() => {
    const items = [
      ...world.chunks.filter((c) => c.reliability < 1).map((c) => ({ id: c.id, title: chunkLabel(world, c), r: c.reliability, kind: "document" as const })),
      ...world.memories.filter((m) => m.reliability < 1).map((m) => ({ id: m.id, title: m.text, r: m.reliability, kind: "memory" as const })),
    ];
    return items.sort((a, b) => a.r - b.r);
  }, [world]);

  if (!hydrated) return <div className="min-h-[60vh]" aria-busy="true" />;

  const dirty = mode === "manual" && FACTORS.some((f) => Math.abs(manual[f] - world.weights[f]) > 0.0005);

  return (
    <div className="mx-auto max-w-[1680px] space-y-5 px-4 py-6 sm:px-6">
      <header>
        <p className="label">Retrieval lab</p>
        <h1 className="t-display-m mt-2 text-foam" style={{ ["--wdth" as string]: 108 }}>
          Ranked by more than similarity
        </h1>
        <p className="mt-2 max-w-2xl text-[14.5px] text-kelp">
          Every candidate is scored on four signals. Feedback in the console moves these weights; here you can see how — and try your own.
        </p>
      </header>

      <div className="panel flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <Formula w={weights} />
        <Segmented
          label="Weights"
          value={mode}
          onChange={(m) => {
            if (m === "manual") setManual(world.weights);
            setMode(m);
          }}
          options={[
            { value: "learned", label: "Learned", hint: "What the assistant uses now" },
            { value: "manual", label: "Try your own", hint: "Preview without changing the assistant" },
          ]}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Panel title="Weights" meta={<span className="data text-kelp">sum = 1.00</span>} bodyClassName="p-5">
          <ul className="space-y-5">
            {FACTORS.map((f) => (
              <li key={f}>
                <div className="mb-1 flex items-baseline justify-between">
                  <label htmlFor={`w-${f}`} className="text-[13px] text-foam">
                    <span className="mono mr-2 text-kelp">{FACTOR_META[f].w}</span>
                    {FACTOR_META[f].name}
                  </label>
                  <NumberTicker value={weights[f]} format={(n) => n.toFixed(2)} className="data text-[13px] text-foam" />
                </div>
                <input
                  id={`w-${f}`}
                  type="range"
                  className="range"
                  min={0.02}
                  max={0.8}
                  step={0.01}
                  disabled={mode === "learned"}
                  value={weights[f]}
                  onChange={(e) => setManual((w) => rebalance(w, f, Number(e.target.value)))}
                  style={{ ["--c" as string]: FACTOR_META[f].color, ["--p" as string]: `${((weights[f] - 0.02) / 0.78) * 100}%` }}
                  aria-describedby={`w-${f}-d`}
                />
                <p id={`w-${f}-d`} className="text-[12px] text-kelp">
                  {FACTOR_META[f].desc}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t hairline pt-4">
            {mode === "learned" ? (
              <p className="text-[12.5px] text-kelp">These were learned from {world.weightHistory.length - 1} pieces of feedback. Choose “Try your own” to experiment.</p>
            ) : (
              <>
                <Button size="sm" variant="primary" disabled={!dirty} onClick={() => setWeights(manual, "Set manually in the Retrieval lab")}>
                  Apply to assistant
                </Button>
                <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setManual(world.weights)}>
                  Reset to learned
                </Button>
              </>
            )}
          </div>
        </Panel>

        <Panel
          title="Ranking"
          meta={
            <button type="button" onClick={() => setShowTable((v) => !v)} className="text-[12px] text-kelp hover:text-foam">
              {showTable ? "Show bars" : "Show factor table"}
            </button>
          }
          bodyClassName="p-4"
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {QUERIES.map((qq) => (
              <button
                key={qq}
                type="button"
                onClick={() => setQuery(qq)}
                className={cx(
                  "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                  query === qq ? "border-sodium/60 text-foam" : "border-shelf text-kelp hover:border-kelp/50 hover:text-foam",
                )}
              >
                {qq}
              </button>
            ))}
          </div>
          <label htmlFor="lab-query" className="sr-only">
            Question to rank sources for
          </label>
          <input
            id="lab-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-3 h-10 w-full rounded-[10px] border border-shelf bg-abyss/60 px-3.5 text-[14px] text-foam outline-none focus:border-kelp/60"
          />
          {LIVE && server.error ? (
            <Empty title="Couldn’t reach the backend">{server.error}</Empty>
          ) : ranked.length === 0 ? (
            <Empty title="No candidates">Nothing is similar enough to this question to be retrieved.</Empty>
          ) : showTable ? (
            <div className="overflow-x-auto">
              <table className="data w-full min-w-[560px] text-left">
                <thead className="text-kelp">
                  <tr>
                    <th className="py-1.5 font-[500]">#</th>
                    <th className="font-[500]">Source</th>
                    {FACTORS.map((f) => (
                      <th key={f} className="text-right font-[500]">
                        {f}
                      </th>
                    ))}
                    <th className="text-right font-[500]">Score</th>
                  </tr>
                </thead>
                <tbody className="text-foam">
                  {ranked.map((c, i) => (
                    <tr key={c.id} className="border-t hairline">
                      <td className="py-1.5">{i + 1}</td>
                      <td className="sans max-w-[240px] truncate text-[12.5px]">{c.title}</td>
                      {FACTORS.map((f) => (
                        <td key={f} className="text-right">
                          {c.factors[f].toFixed(2)}
                        </td>
                      ))}
                      <td className="text-right font-[620]">{c.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <FactorLegend className="mb-1 px-2.5" />
              <LayoutGroup>
                <ol>
                  {ranked.map((c, i) => (
                    <Row key={c.id} c={c} weights={weights} i={i} delta={mode === "manual" ? (before.get(c.id) ?? i) - i : 0} />
                  ))}
                </ol>
              </LayoutGroup>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="How feedback moved the weights" bodyClassName="p-5">
          <LearningCurve history={world.weightHistory} />
        </Panel>
        <Panel title="Source reliability" meta={<span className="data text-kelp">{unreliable.length} adjusted</span>} bodyClassName="p-4">
          {unreliable.length === 0 ? (
            <Empty title="Every source fully trusted">Mark a source as wrong or outdated in the console and its reliability drops here.</Empty>
          ) : (
            <>
              <p className="mb-3 text-[12.5px] text-kelp">Sources whose trust was lowered by feedback. Reliability multiplies a source’s confidence (C).</p>
              <ul className="space-y-3">
                {unreliable.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => useStore.getState().openMemory(u.id)} className="w-full text-left">
                      <span className="mb-1 flex items-center gap-2 text-[12.5px]">
                        <Glyph name={u.kind === "document" ? "document" : "memory"} size={13} className={u.kind === "document" ? "text-glacier" : "text-rhodamine"} />
                        <span className="min-w-0 flex-1 truncate text-foam">{u.title}</span>
                        <span className="data text-foam">{u.r.toFixed(2)}</span>
                      </span>
                      <Meter value={u.r} tone="var(--color-viz-c)" height={6} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Memory classifier" bodyClassName="p-5">
        <ClassifierPlayground />
      </Panel>
    </div>
  );
}
