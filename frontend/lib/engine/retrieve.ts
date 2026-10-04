// Adaptive retrieval: semantic search, then re-ranking on four signals.
//   score = w1·S + w2·R + w3·C + w4·I

import type { Candidate, Chunk, Memory, Retrieval, Weights, World } from "./types";
import { similarity } from "./embed";
import { DAY } from "./forget";
import { detectTopic, docTitle } from "./classify";

const MEMORY_TAU = 30 * DAY;
const DOC_TAU = 365 * DAY;
const SIM_FLOOR = 0.2; // semantic stage: below this, an item is not a candidate
const POOL = 12;
export const TOP_K = 5;

export const DEFAULT_WEIGHTS: Weights = { S: 0.45, R: 0.15, C: 0.25, I: 0.15 };

export function chunkText(c: Chunk) {
  return `${c.title}. ${c.text}`;
}
export function memoryText(m: Memory) {
  return `${m.label}: ${m.text}${m.utterance ? ` — ${m.utterance}` : ""}`;
}

export function scoreOf(f: Weights, w: Weights) {
  return w.S * f.S + w.R * f.R + w.C * f.C + w.I * f.I;
}

function round(x: number) {
  return Math.round(x * 1000) / 1000;
}

export function chunkCandidate(world: World, c: Chunk, query: string, now: number, topicSlot?: string): Candidate {
  const factors = {
    S: round(similarity(query, chunkText(c))),
    R: round(Math.exp(-Math.max(0, now - c.publishedAt) / DOC_TAU)),
    C: round(0.95 * c.reliability),
    I: round(c.importance),
  };
  let note: string | undefined;
  const overriddenSlots = Object.entries(c.overriddenBy ?? {});
  for (const [slot, memId] of overriddenSlots) {
    const m = world.memories.find((x) => x.id === memId);
    if (m && (!topicSlot || topicSlot === slot || overriddenSlots.length === 1)) {
      note = `Overridden for ${m.label.toLowerCase()} → ${m.value ?? m.text} (${m.source.type === "user" ? "your correction" : m.source.label})`;
    }
  }
  return {
    id: c.id,
    kind: "document",
    title: `${shortDoc(docTitle(world, c.docId))} §${c.section}`,
    subtitle: c.title,
    text: c.text,
    factors,
    score: 0,
    rank: 0,
    note,
  };
}

export function memoryCandidate(m: Memory, query: string, now: number): Candidate {
  const last = Math.max(m.createdAt, m.lastUsedAt);
  const factors = {
    S: round(similarity(query, memoryText(m))),
    R: round(Math.exp(-Math.max(0, now - last) / MEMORY_TAU)),
    C: round(m.confidence * m.reliability),
    I: round(m.importance),
  };
  return {
    id: m.id,
    kind: "memory",
    title: m.text,
    subtitle: m.source.type === "user" ? `Learned from you · ${m.label}` : `${m.source.label} · ${m.label}`,
    text: m.utterance ? `You said: “${m.utterance}”` : m.text,
    factors,
    score: 0,
    rank: 0,
    status: m.status,
    cls: m.cls,
  };
}

export function shortDoc(title: string) {
  return title
    .replace("Academic Regulations 2024", "Regulations")
    .replace("Examination Guidelines — Winter 2026", "Exam Guidelines")
    .replace("CSE Department Handbook", "CSE Handbook")
    .replace("CSE Department Circular 2025/14", "CSE Circular");
}

/** All candidates scored (no cut-off) — used by the Retrieval lab. */
export function rankAll(world: World, query: string, weights: Weights, now: number): Candidate[] {
  const topic = detectTopic(query)?.slot;
  const items: Candidate[] = [
    ...world.chunks.map((c) => chunkCandidate(world, c, query, now, topic)),
    ...world.memories.filter((m) => m.status === "current" && m.kind !== "preference").map((m) => memoryCandidate(m, query, now)),
  ];
  for (const it of items) it.score = round(scoreOf(it.factors, weights));
  return items
    .filter((it) => it.factors.S >= SIM_FLOOR)
    .sort((a, b) => b.score - a.score)
    .map((it, i) => ({ ...it, rank: i + 1 }));
}

export function retrieve(world: World, query: string, weights: Weights, now: number): Retrieval {
  const topic = detectTopic(query)?.slot;

  const chunkCands = world.chunks.map((c) => chunkCandidate(world, c, query, now, topic));
  const live = world.memories.filter((m) => m.status === "current" && m.kind !== "preference");
  const memCands = live.map((m) => memoryCandidate(m, query, now));

  // Stage 1 — semantic: the vector-store search
  const pool = [...chunkCands, ...memCands]
    .filter((c) => c.factors.S >= SIM_FLOOR)
    .sort((a, b) => b.factors.S - a.factors.S)
    .slice(0, POOL);

  // Stage 2 — re-rank on all four signals
  for (const c of pool) c.score = round(scoreOf(c.factors, weights));
  const ranked = pool.sort((a, b) => b.score - a.score).slice(0, TOP_K);
  ranked.forEach((c, i) => (c.rank = i + 1));

  // Relevant but filtered out: outdated / expired memories
  const excluded = world.memories
    .filter((m) => m.status !== "current")
    .map((m) => {
      const c = memoryCandidate(m, query, now);
      c.score = round(scoreOf(c.factors, weights));
      if (m.status === "outdated") {
        const by = world.memories.find((x) => x.id === m.supersededBy);
        c.excluded = by ? `Replaced by “${by.text}”` : "Marked outdated";
      } else {
        c.excluded = "Expired — it was only relevant for a short time";
      }
      return c;
    })
    .filter((c) => c.factors.S >= 0.3)
    .sort((a, b) => b.factors.S - a.factors.S)
    .slice(0, 3);

  const preferences = world.memories
    .filter((m) => m.status === "current" && m.kind === "preference")
    .map((m) => ({ id: m.id, text: m.text }));

  return {
    query,
    candidates: ranked,
    excluded,
    weights: { ...weights },
    searched: { chunks: world.chunks.length, memories: world.memories.filter((m) => m.status === "current").length },
    pool: pool.length,
    preferences,
    ping: pingFor(world, ranked),
  };
}

/** Where the question "lands" on the map: the score-weighted centre of its top hits. */
export function pingFor(world: World, ranked: Candidate[]): [number, number] {
  let x = 0;
  let y = 0;
  let w = 0;
  for (const c of ranked.slice(0, 3)) {
    const p = world.positions[c.id];
    if (!p) continue;
    const k = c.score * c.score;
    x += p[0] * k;
    y += p[1] * k;
    w += k;
  }
  return w ? [x / w, y / w] : [0, 0];
}
