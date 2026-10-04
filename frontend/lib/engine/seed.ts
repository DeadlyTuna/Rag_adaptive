// The starting world: four indexed documents plus six weeks of "earlier sessions" —
// memories learned, one fact corrected, one preference changed, one temporary
// memory expired, and nine rounds of feedback that shaped the ranking weights.

import type { ActivityEvent, Chunk, DocumentMeta, Memory, WeightPoint, World } from "./types";
import { DOCUMENTS, type SeedDocument } from "./corpus";
import { DAY, HOUR } from "./forget";
import { mds } from "./project";
import { chunkText, memoryText } from "./retrieve";

export const WORLD_VERSION = 3;

export function chunksFor(doc: SeedDocument, indexedAt: number): Chunk[] {
  const publishedAt = Date.parse(doc.published + "T09:00:00");
  return doc.sections.map((s) => ({
    id: `${doc.id}-${s.section}`,
    docId: doc.id,
    section: s.section,
    title: s.title,
    text: s.text,
    tokens: Math.round(s.text.split(/\s+/).length * 1.3),
    importance: s.importance ?? 0.5,
    reliability: 1,
    publishedAt,
    indexedAt,
    claims: s.claims ?? [],
  }));
}

export function docMetaFor(doc: SeedDocument, indexedAt: number, chunks: Chunk[]): DocumentMeta {
  return {
    id: doc.id,
    title: doc.title,
    issuer: doc.issuer,
    publishedAt: Date.parse(doc.published + "T09:00:00"),
    indexedAt,
    chunkIds: chunks.map((c) => c.id),
  };
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(now: number): World {
  const d = (days: number, hours = 0) => Math.round(now - days * DAY - hours * HOUR);

  // ---- documents & chunks
  const documents: DocumentMeta[] = [];
  const chunks: Chunk[] = [];
  const indexDays: Record<string, number> = { regs: 45, exams: 45, hostel: 44, cse: 43 };
  for (const doc of DOCUMENTS) {
    const at = d(indexDays[doc.id] ?? 45, 3);
    const cs = chunksFor(doc, at);
    chunks.push(...cs);
    documents.push(docMetaFor(doc, at, cs));
  }

  // reliability learned from earlier feedback
  const rel: Record<string, number> = { "hostel-2": 0.85, "regs-9.1": 0.85, "regs-5.2": 0.85, "exams-3": 0.88, "cse-3": 0.85 };
  for (const c of chunks) if (rel[c.id]) c.reliability = rel[c.id];

  // ---- memories from earlier sessions
  const user = { type: "user" as const, label: "You" };
  const base = (m: Partial<Memory> & Pick<Memory, "id" | "label" | "text" | "cls" | "kind" | "createdAt">): Memory => ({
    slot: null,
    source: user,
    confidence: 0.9,
    importance: 0.7,
    reliability: 1,
    status: "current",
    pinned: false,
    lastUsedAt: m.createdAt,
    uses: [],
    ...m,
  });

  const memories: Memory[] = [
    base({
      id: "mem-name",
      slot: "user.name",
      label: "Name",
      text: "Name: Harsh",
      value: "Harsh",
      cls: "persistent",
      kind: "profile",
      utterance: "My name is Harsh.",
      createdAt: d(41, 5),
      uses: [d(30), d(12), d(3)],
    }),
    base({
      id: "mem-dept",
      slot: "user.department",
      label: "Department",
      text: "Studies CSE, semester 3",
      value: "CSE",
      cls: "persistent",
      kind: "profile",
      utterance: "I'm in CSE, third semester.",
      createdAt: d(41, 4),
      uses: [d(20), d(6)],
    }),
    base({
      id: "mem-courses",
      label: "Courses",
      text: "Taking DBMS, Operating Systems and COA this semester",
      cls: "persistent",
      kind: "profile",
      utterance: "This semester I'm taking DBMS, OS and COA.",
      createdAt: d(40, 20),
      uses: [d(9)],
    }),
    base({
      id: "mem-style-old",
      slot: "user.style",
      label: "Answer style",
      text: "Prefers answers as bullet points",
      value: "bullet points",
      cls: "persistent",
      kind: "preference",
      confidence: 0.92,
      importance: 0.75,
      utterance: "I like answers as bullet points.",
      createdAt: d(40, 2),
      status: "outdated",
      supersededBy: "mem-style",
      supersededAt: d(38, 6),
    }),
    base({
      id: "mem-style",
      slot: "user.style",
      label: "Answer style",
      text: "Prefers step-by-step explanations",
      value: "step-by-step",
      previousValue: "bullet points",
      supersedes: "mem-style-old",
      cls: "persistent",
      kind: "preference",
      confidence: 0.92,
      importance: 0.75,
      utterance: "I prefer step-by-step explanations, please.",
      createdAt: d(38, 6),
      uses: [d(30), d(21), d(12), d(5), d(2)],
    }),
    base({
      id: "mem-hostel",
      label: "Residence",
      text: "Lives in hostel block C",
      cls: "persistent",
      kind: "profile",
      utterance: "I stay in block C of the hostel.",
      createdAt: d(35, 8),
      uses: [d(16)],
    }),
    base({
      id: "mem-library",
      slot: "library.hours",
      label: "Library hours",
      text: "Library closes at 10 pm on weekdays",
      value: "closes 10 pm",
      previousValue: "8 am – 8 pm",
      supersedes: "chunk:regs-9.1",
      cls: "correction",
      kind: "fact",
      confidence: 0.78,
      importance: 0.9,
      utterance: "Actually, the library closes at 10 pm on weekdays now.",
      createdAt: d(27, 3),
      uses: [d(15)],
    }),
    base({
      id: "mem-cat2",
      label: "CAT-2 marks",
      text: "CAT-2 marks are published on the student portal",
      cls: "important",
      kind: "fact",
      confidence: 0.7,
      importance: 0.85,
      utterance: "Prof. Rao said CAT-2 marks will be on the student portal.",
      createdAt: d(19, 2),
      uses: [d(10)],
    }),
    base({
      id: "mem-lab-deadline",
      label: "Lab record deadline",
      text: "DBMS lab record deadline moved to Friday of week 12",
      cls: "important",
      kind: "fact",
      confidence: 0.74,
      importance: 0.85,
      utterance: "The professor changed the DBMS lab record deadline to Friday of week 12.",
      createdAt: d(12, 7),
      uses: [d(4)],
    }),
    base({
      id: "mem-viva",
      slot: "event.exam",
      label: "Upcoming exam",
      text: "OS lab viva today",
      value: "OS viva today",
      cls: "temporary",
      kind: "event",
      confidence: 0.85,
      importance: 0.5,
      utterance: "I have an OS lab viva today.",
      createdAt: d(9, 6),
      expiresAt: d(8, 6),
      status: "expired",
      expiredAt: d(8, 6),
    }),
  ];
  for (const m of memories) m.lastUsedAt = Math.max(m.createdAt, ...m.uses);

  // library correction overrides the regulation's claim for that slot
  const lib = chunks.find((c) => c.id === "regs-9.1");
  if (lib) lib.overriddenBy = { "library.hours": "mem-library" };

  // ---- ranking weights shaped by nine rounds of feedback
  const weightHistory: WeightPoint[] = [
    { at: d(45), weights: { S: 0.4, R: 0.2, C: 0.2, I: 0.2 }, label: "Initial weights" },
    { at: d(33, 4), weights: { S: 0.42, R: 0.19, C: 0.2, I: 0.19 }, label: "Wrong source: Hostel Handbook §2 for a library question" },
    { at: d(29, 2), weights: { S: 0.42, R: 0.18, C: 0.21, I: 0.19 }, label: "Helpful: FAT eligibility answer" },
    { at: d(24, 6), weights: { S: 0.41, R: 0.2, C: 0.22, I: 0.17 }, label: "Outdated: Regulations §9.1 library hours" },
    { at: d(18, 1), weights: { S: 0.44, R: 0.19, C: 0.22, I: 0.15 }, label: "Wrong source: Regulations §5.2 for a pass-mark question" },
    { at: d(14, 3), weights: { S: 0.44, R: 0.18, C: 0.23, I: 0.15 }, label: "Helpful: re-examination deadline" },
    { at: d(9, 5), weights: { S: 0.45, R: 0.17, C: 0.23, I: 0.15 }, label: "Wrong source: Exam Guidelines §3 for a hall-ticket question" },
    { at: d(6, 2), weights: { S: 0.45, R: 0.16, C: 0.24, I: 0.15 }, label: "Helpful: lab record deadline" },
    { at: d(4, 8), weights: { S: 0.44, R: 0.16, C: 0.25, I: 0.15 }, label: "Wrong source: CSE Handbook §3 for an attendance question" },
    { at: d(2, 3), weights: { S: 0.45, R: 0.15, C: 0.25, I: 0.15 }, label: "Helpful: condonation answer" },
  ];

  // ---- activity log
  const ev = (id: string, type: ActivityEvent["type"], at: number, title: string, detail: string, refId?: string): ActivityEvent => ({
    id,
    type,
    at,
    title,
    detail,
    refId,
  });
  const events: ActivityEvent[] = [
    ...documents.map((doc) =>
      ev(`ev-doc-${doc.id}`, "document.indexed", doc.indexedAt, "Document indexed", `${doc.title} · ${doc.chunkIds.length} chunks`, doc.id),
    ),
    ev("ev-name", "memory.added", d(41, 5), "Profile learned", "Name: Harsh", "mem-name"),
    ev("ev-dept", "memory.added", d(41, 4), "Profile learned", "Studies CSE, semester 3", "mem-dept"),
    ev("ev-courses", "memory.added", d(40, 20), "Profile learned", "Taking DBMS, Operating Systems and COA", "mem-courses"),
    ev("ev-style-old", "memory.preference", d(40, 2), "Preference learned", "Prefers answers as bullet points", "mem-style-old"),
    ev("ev-style", "memory.replaced", d(38, 6), "Preference updated", "Bullet points → step-by-step explanations", "mem-style"),
    ev("ev-hostel", "memory.added", d(35, 8), "Profile learned", "Lives in hostel block C", "mem-hostel"),
    ev("ev-library", "memory.replaced", d(27, 3), "Previous fact corrected", "Library hours: 8 am – 8 pm → closes at 10 pm on weekdays", "mem-library"),
    ev("ev-cat2", "memory.added", d(19, 2), "New knowledge added", "CAT-2 marks are published on the student portal", "mem-cat2"),
    ev("ev-lab", "memory.added", d(12, 7), "New knowledge added", "DBMS lab record deadline moved to Friday of week 12", "mem-lab-deadline"),
    ev("ev-viva", "memory.added", d(9, 6), "Temporary memory kept", "OS lab viva today", "mem-viva"),
    ev("ev-viva-x", "memory.expired", d(8, 6), "Temporary memory expired", "OS lab viva today", "mem-viva"),
    ...weightHistory.slice(1).map((p, i) =>
      ev(`ev-w-${i}`, "weights.updated", p.at, "Ranking weights updated", p.label),
    ),
  ].sort((a, b) => a.at - b.at);

  // ---- past queries: 47 over six weeks, denser recently
  const rnd = mulberry(42);
  const queries: number[] = [];
  for (let i = 0; i < 47; i++) {
    const u = Math.pow(rnd(), 0.7); // skew towards recent
    queries.push(Math.round(now - (1 - u) * 41 * DAY - rnd() * 6 * HOUR - 2 * HOUR));
  }
  queries.sort((a, b) => a - b);

  // ---- map positions (classical MDS over everything)
  const placeables = [
    ...chunks.map((c) => ({ id: c.id, text: chunkText(c) })),
    ...memories.map((m) => ({ id: m.id, text: memoryText(m) })),
  ];
  const positions = mds(placeables);

  return {
    version: WORLD_VERSION,
    seededAt: now,
    documents,
    chunks,
    memories,
    turns: [],
    events,
    queries,
    weights: { ...weightHistory[weightHistory.length - 1].weights },
    weightHistory,
    positions,
    scriptDone: [],
  };
}
