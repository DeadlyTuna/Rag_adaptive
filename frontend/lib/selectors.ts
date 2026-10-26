// Derived views of the world — what the terrain, KPI row, bank and charts render.

import type { ActivityEvent, Chunk, Memory, World } from "./engine/types";
import { DAY } from "./engine/forget";
import { statusAt, strengthAt } from "./engine/forget";
import { docTitle } from "./engine/classify";
import { shortDoc } from "./engine/retrieve";
import { chunkStaleness, memoryStaleness } from "./engine/staleness";

export interface TerrainItem {
  id: string;
  x: number;
  y: number;
  w: number; // kernel weight (height)
  mem: number; // 0 = document, 1 = memory
  sigma: number;
  ghost?: boolean; // outdated: drawn as a dashed outline
  kind: "document" | "memory";
  label: string;
  short: string;
}

export function chunkWeight(c: Chunk) {
  return (0.34 + 0.3 * c.importance) * (0.55 + 0.45 * c.reliability);
}

export function memoryWeight(m: Memory, t: number) {
  return 0.22 + 0.85 * strengthAt(m, t);
}

export function chunkLabel(world: World, c: Chunk) {
  return `${shortDoc(docTitle(world, c.docId))} §${c.section} · ${c.title}`;
}

export function memoryLabel(m: Memory, max = 34) {
  if (m.slot === "attendance.minimum") return `Min. attendance ${m.value}`;
  if (m.slot === "user.style") return `Style: ${m.value}`;
  if (m.slot === "library.hours") return `Library ${m.value}`;
  return m.text.length > max ? m.text.slice(0, max - 1).trimEnd() + "…" : m.text;
}

/** Items for the terrain as of time `t` (the "as of" scrubber passes a past time). */
export function terrainItems(world: World, t: number): TerrainItem[] {
  const out: TerrainItem[] = [];
  for (const c of world.chunks) {
    const p = world.positions[c.id];
    if (!p) continue;
    const present = c.indexedAt <= t;
    out.push({
      id: c.id,
      x: p[0],
      y: p[1],
      w: present ? chunkWeight(c) : 0,
      mem: 0,
      sigma: 0.125,
      kind: "document",
      label: chunkLabel(world, c),
      short: `${shortDoc(docTitle(world, c.docId))} §${c.section}`,
    });
  }
  for (const m of world.memories) {
    const p = world.positions[m.id];
    if (!p) continue;
    const st = statusAt(m, t);
    out.push({
      id: m.id,
      x: p[0],
      y: p[1],
      w: st === "current" ? memoryWeight(m, t) : 0,
      mem: 1,
      sigma: m.cls === "temporary" ? 0.085 : 0.105,
      ghost: st === "outdated",
      kind: "memory",
      label: memoryLabel(m),
      short: memoryLabel(m, 22),
    });
  }
  return out;
}

/** The same map coloured by staleness instead of by source (0 fresh … 1 stale). Stale
 * things are also raised (and replaced memories, flat on the normal map, get a low bump)
 * so the warm regions stand out instead of averaging away into their fresh neighbours. */
export function stalenessItems(world: World, t: number): TerrainItem[] {
  const chunks = new Map(world.chunks.map((c) => [c.id, c]));
  const mems = new Map(world.memories.map((m) => [m.id, m]));
  return terrainItems(world, t).map((it) => {
    const c = chunks.get(it.id);
    const m = c ? undefined : mems.get(it.id);
    const s = c ? chunkStaleness(c, t) : m ? memoryStaleness(m, t) : 0;
    const inactive = !!m && it.w === 0 && statusAt(m, t) !== "future";
    return { ...it, mem: s, w: inactive ? 0.32 : it.w * (0.45 + 0.9 * s) };
  });
}

// ------------------------------------------------------------------ stats

export interface Stats {
  chunks: number;
  memories: number;
  corrections: number;
  conflicts: number;
  queries: number;
}

export function statsAt(world: World, t: number): Stats {
  const mems = world.memories.filter((m) => m.createdAt <= t);
  return {
    chunks: world.chunks.filter((c) => c.indexedAt <= t).length,
    memories: mems.filter((m) => m.cls !== "temporary" && statusAt(m, t) === "current").length,
    corrections: mems.filter((m) => m.cls === "correction").length,
    conflicts: mems.filter((m) => m.supersedes).length,
    queries: world.queries.filter((q) => q <= t).length,
  };
}

/** Value of each stat at the end of each of the last `days` days up to `t`. */
export function statSeries(world: World, t: number, days = 12): Record<keyof Stats, number[]> {
  const keys: (keyof Stats)[] = ["chunks", "memories", "corrections", "conflicts", "queries"];
  const series = Object.fromEntries(keys.map((k) => [k, [] as number[]])) as Record<keyof Stats, number[]>;
  for (let i = days - 1; i >= 0; i--) {
    const s = statsAt(world, t - i * DAY);
    for (const k of keys) series[k].push(s[k]);
  }
  return series;
}

// ------------------------------------------------------------------ history

export interface Version {
  id: string;
  value: string;
  source: string;
  confidence: number;
  at: number;
  current: boolean;
  kind: "document" | "memory";
}

export interface Chain {
  slot: string;
  label: string;
  versions: Version[];
}

/** Every slot whose value has changed at least once, oldest version first. */
export function versionChains(world: World, t: number): Chain[] {
  const bySlot = new Map<string, Memory[]>();
  for (const m of world.memories) {
    if (!m.slot || m.createdAt > t) continue;
    bySlot.set(m.slot, [...(bySlot.get(m.slot) ?? []), m]);
  }
  const chains: Chain[] = [];
  for (const [slot, mems] of bySlot) {
    const sorted = [...mems].sort((a, b) => a.createdAt - b.createdAt);
    const versions: Version[] = [];
    const first = sorted[0];
    if (first.supersedes?.startsWith("chunk:")) {
      const chunk = world.chunks.find((c) => c.id === first.supersedes!.slice(6));
      if (chunk) {
        const claim = chunk.claims.find((c) => c.slot === slot);
        versions.push({
          id: chunk.id,
          value: claim?.value ?? first.previousValue ?? "—",
          source: `${shortDoc(docTitle(world, chunk.docId))} §${chunk.section}`,
          confidence: 0.95,
          at: chunk.publishedAt,
          current: false,
          kind: "document",
        });
      }
    }
    for (const m of sorted) {
      if (m.cls === "temporary") continue;
      versions.push({
        id: m.id,
        value: m.value ?? m.text,
        source: m.source.type === "user" ? "You" : m.source.label,
        confidence: m.confidence,
        at: m.createdAt,
        current: statusAt(m, t) === "current",
        kind: "memory",
      });
    }
    if (versions.length >= 2) chains.push({ slot, label: first.label, versions });
  }
  return chains.sort((a, b) => b.versions[b.versions.length - 1].at - a.versions[a.versions.length - 1].at);
}

export function eventsAt(world: World, t: number): ActivityEvent[] {
  return world.events.filter((e) => e.at <= t).sort((a, b) => b.at - a.at);
}

export function memoryById(world: World, id: string | null | undefined) {
  return id ? world.memories.find((m) => m.id === id) : undefined;
}

export function itemTitle(world: World, id: string): string {
  const c = world.chunks.find((x) => x.id === id);
  if (c) return chunkLabel(world, c);
  const m = world.memories.find((x) => x.id === id);
  return m ? m.text : id;
}
