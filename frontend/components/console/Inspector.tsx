"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Candidate, Turn, Weights } from "@/lib/engine/types";
import { FACTORS } from "@/lib/engine/types";
import { Glyph } from "@/components/ui/Glyph";
import { FactorLegend, ScoreBar } from "@/components/ui/ScoreBar";
import { Meter, NumberTicker } from "@/components/ui/motion-bits";
import { LazyTerrain, TerrainLegend } from "@/components/terrain/LazyTerrain";
import { OpChip } from "./ClassifierStrip";
import { FACTOR_META } from "@/lib/factors";
import { terrainItems } from "@/lib/selectors";
import { cx } from "@/lib/format";
import { useNow, useStore } from "@/lib/store";

function CandidateRow({ c, weights, i, excluded = false }: { c: Candidate; weights: Weights; i: number; excluded?: boolean }) {
  const hover = useStore((s) => s.hover);
  const open = useStore((s) => s.openMemory);
  const active = useStore((s) => s.hoverId === c.id);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: i * 0.05, duration: 0.35 }}
      onPointerEnter={() => hover(c.id)}
      onPointerLeave={() => hover(null)}
    >
      <button
        type="button"
        onClick={() => open(c.id)}
        onFocus={() => hover(c.id)}
        onBlur={() => hover(null)}
        className={cx(
          "grid w-full grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2.5 rounded-[10px] px-2.5 py-2.5 text-left transition-colors",
          active ? "bg-reef" : "hover:bg-reef/60",
          excluded && "opacity-70",
        )}
      >
        <span className="data pt-[2px] text-kelp">{excluded ? "–" : c.rank}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <Glyph
              name={excluded ? "outdated" : c.kind === "document" ? "document" : c.cls === "correction" ? "correction" : "memory"}
              size={13}
              className={cx("shrink-0", excluded ? "text-kelp" : c.kind === "document" ? "text-glacier" : c.cls === "correction" ? "text-sodium" : "text-rhodamine")}
            />
            <span className={cx("truncate text-[13px] font-[560]", excluded ? "text-kelp line-through decoration-kelp/50" : "text-foam")}>{c.title}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-kelp">{excluded ? c.excluded : c.subtitle}</span>
          {!excluded && <ScoreBar factors={c.factors} weights={weights} className="mt-2" delay={0.25 + i * 0.08} />}
          {c.note && !excluded && (
            <span className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-kelp">
              <Glyph name={c.note.startsWith("Overridden") ? "correction" : "ping"} size={12} className={cx("mt-[1px] shrink-0", c.note.startsWith("Overridden") ? "text-sodium" : "text-kelp")} />
              {c.note}
            </span>
          )}
        </span>
        <span className={cx("data pt-[1px] text-[12.5px]", excluded ? "text-kelp" : "text-foam")}>{c.score.toFixed(2)}</span>
      </button>
    </motion.li>
  );
}

/** Same ids → same array, so the map isn't re-highlighted on every render. */
function useStableIds(ids: string[]) {
  const key = ids.join("|");
  return useMemo(() => (key ? key.split("|") : []), [key]);
}

function Section({ title, meta, children }: { title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t hairline px-4 py-4 first:border-t-0">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="label">{title}</h3>
        {meta}
      </div>
      {children}
    </section>
  );
}

export function Inspector({ className }: { className?: string }) {
  const world = useStore((s) => s.world);
  const selectedId = useStore((s) => s.selectedTurnId);
  const hoverId = useStore((s) => s.hoverId);
  const ping = useStore((s) => s.ping);
  const pulse = useStore((s) => s.pulse);
  const open = useStore((s) => s.openMemory);
  const hover = useStore((s) => s.hover);
  const now = useNow(30_000);

  const assistants = world.turns.filter((t) => t.role === "assistant");
  const turn: Turn | undefined = assistants.find((t) => t.id === selectedId) ?? assistants[assistants.length - 1];
  const userTurn = turn ? world.turns.find((t) => t.id === turn.replyTo) : undefined;
  const r = turn?.retrieval;
  const items = useMemo(() => terrainItems(world, now), [world, now]);
  const highlight = useStableIds(r ? r.candidates.slice(0, 5).map((c) => c.id) : []);
  const ops = userTurn?.memoryOps?.filter((o) => o.kind !== "discard") ?? [];
  const extra = r ? r.query.slice(userTurn?.text.length ?? 0).trim() : "";

  return (
    <aside className={cx("flex min-h-0 flex-col", className)} aria-label="Inspector">
      <div className="flex items-center justify-between gap-3 border-b hairline px-4 py-3">
        <div className="min-w-0">
          <p className="label">Inspector</p>
          <p className="mt-1 truncate text-[13px] text-foam">{userTurn ? `“${userTurn.text}”` : "Nothing asked yet"}</p>
        </div>
        {turn && assistants.length > 1 && (
          <span className="data shrink-0 text-kelp">
            {assistants.indexOf(turn) + 1}/{assistants.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Memory map"
          meta={
            <Link href="/memory" className="flex items-center gap-1 text-[11.5px] text-kelp hover:text-foam">
              Open in 3-D <ArrowUpRight size={12} />
            </Link>
          }
        >
          <LazyTerrain
            items={items}
            mode="flat"
            ping={ping}
            pulse={pulse}
            highlight={highlight}
            hoverId={hoverId}
            onHover={hover}
            onSelect={open}
            compactLabels
            ariaLabel={`Memory map: ${world.chunks.length} document passages and ${world.memories.filter((m) => m.status === "current").length} current memories. Peaks are stronger items; highlighted rings are the sources used for the selected answer.`}
            className="h-[230px] rounded-[12px] border border-shelf/70 bg-abyss/40"
          />
          <TerrainLegend className="mt-2" />
        </Section>

        <Section
          title="Retrieved for this answer"
          meta={r ? <span className="data text-kelp">{r.candidates.length} used</span> : undefined}
        >
          {!r ? (
            <p className="text-[13px] text-kelp">Ask something to see which passages and memories it picks, and why each one ranks where it does.</p>
          ) : r.candidates.length === 0 ? (
            <p className="text-[13px] text-kelp">Answered directly — no documents or memories were needed.</p>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-kelp">
                Searched {r.searched.chunks} passages and {r.searched.memories} memories → {r.pool} similar enough → top {Math.min(5, r.candidates.length)} re-ranked.
              </p>
              {extra && (
                <p className="mono mb-3 rounded-[8px] border border-shelf/70 bg-abyss/40 px-2.5 py-1.5 text-[11.5px] text-kelp">
                  <span className="text-foam">+ </span>
                  {extra}
                  <span className="sans ml-1 text-kelp/80">(added from context)</span>
                </p>
              )}
              <FactorLegend className="mb-1.5 px-2.5" />
              <ul className="-mx-1.5">
                <AnimatePresence initial={false}>
                  {r.candidates.map((c, i) => (
                    <CandidateRow key={`${turn!.id}-${c.id}`} c={c} weights={r.weights} i={i} />
                  ))}
                </AnimatePresence>
              </ul>
              {r.excluded.length > 0 && (
                <>
                  <p className="label mb-1 mt-3">Filtered out</p>
                  <ul className="-mx-1.5">
                    {r.excluded.map((c, i) => (
                      <CandidateRow key={`${turn!.id}-x-${c.id}`} c={c} weights={r.weights} i={i} excluded />
                    ))}
                  </ul>
                </>
              )}
              {r.preferences.length > 0 && (
                <p className="mt-3 flex items-start gap-2 text-[12px] text-kelp">
                  <Glyph name="preference" size={13} className="mt-[1px] shrink-0 text-rhodamine" />
                  <span>
                    Always applied: <span className="text-foam">{r.preferences.map((p) => p.text).join(", ")}</span>
                  </span>
                </p>
              )}
            </>
          )}
        </Section>

        <Section
          title="Ranking weights"
          meta={
            <Link href="/retrieval" className="flex items-center gap-1 text-[11.5px] text-kelp hover:text-foam">
              Tune <ArrowUpRight size={12} />
            </Link>
          }
        >
          <p className="mono mb-3 text-[12px] text-kelp">score = w₁·S + w₂·R + w₃·C + w₄·I</p>
          <ul className="grid grid-cols-2 gap-x-5 gap-y-2.5">
            {FACTORS.map((f) => (
              <li key={f}>
                <div className="mb-1 flex items-baseline justify-between text-[12px]">
                  <span className="text-kelp">
                    {FACTOR_META[f].w} · {FACTOR_META[f].name}
                  </span>
                  <NumberTicker value={world.weights[f]} format={(n) => n.toFixed(2)} className="data text-foam" />
                </div>
                <Meter value={world.weights[f] / 0.6} tone={FACTOR_META[f].color} height={5} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Memory writes">
          {ops.length ? (
            <div className="space-y-1.5">
              {ops.map((op, i) => (
                <OpChip key={`${userTurn!.id}-${i}`} op={op} delay={i * 0.08} />
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-kelp">{userTurn ? "This message didn't change memory." : "Facts, preferences and corrections you share will show up here."}</p>
          )}
        </Section>
      </div>
    </aside>
  );
}
