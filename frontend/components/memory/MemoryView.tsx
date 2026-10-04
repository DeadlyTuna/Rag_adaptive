"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useDeferredValue, useMemo, useState } from "react";
import { History } from "lucide-react";
import { Panel, Empty } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { NumberTicker } from "@/components/ui/motion-bits";
import { ButtonLink, Button } from "@/components/ui/Button";
import { LazyTerrain, TerrainLegend } from "@/components/terrain/LazyTerrain";
import { Scrubber } from "./Scrubber";
import { Sparkline } from "./Sparkline";
import { MemoryCard } from "./MemoryCard";
import { ActivityFeed } from "./ActivityFeed";
import { VersionChain } from "./VersionChain";
import { DAY, statusAt } from "@/lib/engine/forget";
import { eventsAt, statSeries, statsAt, terrainItems, versionChains, type Stats } from "@/lib/selectors";
import { day, relTime } from "@/lib/format";
import { useHydrated, useNow, useStore } from "@/lib/store";

type TypeFilter = "all" | "you" | "facts" | "corrections" | "temporary";
type StatusFilter = "current" | "history" | "all";

const TILES: { key: keyof Stats; label: string }[] = [
  { key: "chunks", label: "Passages indexed" },
  { key: "memories", label: "Long-term memories" },
  { key: "corrections", label: "Corrections" },
  { key: "conflicts", label: "Conflicts resolved" },
  { key: "queries", label: "Messages processed" },
];

function StatTile({ label, value, prev, series }: { label: string; value: number; prev: number; series: number[] }) {
  const delta = value - prev;
  return (
    <div className="panel flex min-w-0 flex-col p-4">
      <p className="truncate text-[12.5px] text-kelp">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <NumberTicker value={value} className="t-stat text-foam" />
        <Sparkline values={series} label={`${label} over the last 12 days`} />
      </div>
      <p className="mt-2 text-[12px] text-kelp">{delta > 0 ? `+${delta} in the last day` : "No change in the last day"}</p>
    </div>
  );
}

export function MemoryView() {
  const hydrated = useHydrated();
  const world = useStore((s) => s.world);
  const pulse = useStore((s) => s.pulse);
  const hoverId = useStore((s) => s.hoverId);
  const hover = useStore((s) => s.hover);
  const open = useStore((s) => s.openMemory);
  const now = useNow(15_000);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [mode, setMode] = useState<"relief" | "flat">("relief");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("current");

  const t = asOf ?? now;
  const slowT = useDeferredValue(t);
  const start = useMemo(() => Math.min(world.seededAt - 45 * DAY, ...world.events.map((e) => e.at)), [world]);

  const items = useMemo(() => terrainItems(world, t), [world, t]);
  const stats = useMemo(() => statsAt(world, slowT), [world, slowT]);
  const prev = useMemo(() => statsAt(world, slowT - DAY), [world, slowT]);
  const series = useMemo(() => statSeries(world, slowT), [world, slowT]);
  const events = useMemo(() => eventsAt(world, slowT), [world, slowT]);
  const chains = useMemo(() => versionChains(world, slowT), [world, slowT]);

  const recent = useMemo(
    () =>
      world.memories
        .filter((m) => statusAt(m, t) === "current")
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 3)
        .map((m) => m.id),
    [world, t],
  );

  const bank = useMemo(() => {
    return world.memories
      .filter((m) => m.createdAt <= slowT)
      .filter((m) => {
        if (type === "you") return m.kind === "profile" || m.kind === "preference";
        if (type === "facts") return m.kind === "fact" && m.cls !== "correction";
        if (type === "corrections") return m.cls === "correction";
        if (type === "temporary") return m.cls === "temporary";
        return true;
      })
      .filter((m) => {
        const st = statusAt(m, slowT);
        if (status === "current") return st === "current";
        if (status === "history") return st === "outdated" || st === "expired";
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [world, slowT, type, status]);

  if (!hydrated) return <div className="min-h-[60vh]" aria-busy="true" />;

  return (
    <div className="mx-auto max-w-[1680px] space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Memory</p>
          <h1 className="t-display-m mt-2 text-foam" style={{ ["--wdth" as string]: 108 }}>
            Everything it has learned
          </h1>
          <p className="mt-2 max-w-2xl text-[14.5px] text-kelp">
            What it remembers about you and the rules, which facts it replaced, and what it let go. Drag the timeline to rewind.
          </p>
        </div>
      </header>

      <div className="panel px-4 py-3">
        <Scrubber start={start} now={now} value={asOf} onChange={setAsOf} events={world.events} />
      </div>

      <AnimatePresence>
        {asOf !== null && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-[12px] border border-sodium/40 bg-sodium/[0.06] px-4 py-2.5 text-[13px] text-foam">
              <History size={15} className="text-sodium" />
              Showing memory as it was on {day(asOf)} ({relTime(asOf, now)}). Everything below is filtered to that moment.
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAsOf(null)}>
                Back to now
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {TILES.map((tile) => (
          <StatTile key={tile.key} label={tile.label} value={stats[tile.key]} prev={prev[tile.key]} series={series[tile.key]} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Knowledge terrain"
          meta={
            <Segmented
              label="Map view"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "relief", label: "3-D relief" },
                { value: "flat", label: "2-D map" },
              ]}
            />
          }
        >
          <div className="relative">
            <LazyTerrain
              items={items}
              mode={mode}
              pulse={pulse}
              hoverId={hoverId}
              forcedLabels={recent}
              onHover={hover}
              onSelect={open}
              ariaLabel={`Knowledge terrain as of ${day(t)}: ${stats.chunks} document passages and ${stats.memories} long-term memories. Height is how strongly each one is held; dashed outlines are facts that were replaced.`}
              className="h-[clamp(320px,52vh,560px)]"
            />
            <div className="pointer-events-none absolute inset-x-4 bottom-3 flex flex-wrap items-end justify-between gap-2">
              <TerrainLegend />
              <p className="text-[11px] text-kelp">Height = how strongly it’s held · click a peak to inspect it</p>
            </div>
          </div>
        </Panel>
        <Panel title="Activity">
          <div className="h-[clamp(320px,52vh,560px)] pt-2">
            <ActivityFeed events={events} now={now} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel
          title="Memory bank"
          meta={<span className="data text-kelp">{bank.length} shown</span>}
          bodyClassName="p-4"
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Segmented
              label="Type"
              size="sm"
              value={type}
              onChange={setType}
              options={[
                { value: "all", label: "All" },
                { value: "you", label: "About you" },
                { value: "facts", label: "Facts" },
                { value: "corrections", label: "Corrections" },
                { value: "temporary", label: "Temporary" },
              ]}
            />
            <Segmented
              label="Status"
              size="sm"
              value={status}
              onChange={setStatus}
              options={[
                { value: "current", label: "Current" },
                { value: "history", label: "Replaced & expired" },
                { value: "all", label: "Everything" },
              ]}
            />
          </div>
          {bank.length === 0 ? (
            <Empty title="Nothing here yet" action={<ButtonLink href="/console" size="sm">Open the console</ButtonLink>}>
              Tell the assistant a fact, a preference or a correction in the console and it will show up here.
            </Empty>
          ) : (
            <LayoutGroup>
              <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                <AnimatePresence mode="popLayout" initial={false}>
                  {bank.map((m) => (
                    <MemoryCard key={m.id} m={m} world={world} t={slowT} />
                  ))}
                </AnimatePresence>
              </ul>
            </LayoutGroup>
          )}
        </Panel>

        <Panel title="Facts that changed" meta={<span className="data text-kelp">{chains.length}</span>} bodyClassName="p-4">
          {chains.length === 0 ? (
            <Empty title="No changes yet">When a correction replaces something it believed, the before and after appear here.</Empty>
          ) : (
            <ul className="space-y-5">
              {chains.map((c) => (
                <li key={c.slot}>
                  <p className="mb-2 text-[13px] font-[600] text-foam">{c.label}</p>
                  <VersionChain chain={c} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
