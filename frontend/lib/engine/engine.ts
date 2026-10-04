// The demo engine: pure functions from (world, input, now) → new world + what happened.
// The UI never mutates the world directly; it animates the results these return.

import type {
  ActivityEvent,
  Candidate,
  Classification,
  Feedback,
  Memory,
  MemoryOp,
  Turn,
  Weights,
  World,
} from "./types";
import { classify, docTitle, importanceFor, slotDef, userConfidence } from "./classify";
import { compose } from "./compose";
import { DAY } from "./forget";
import { deltas, lowerReliability, normalise, pairwiseUpdate, raiseReliability, reinforceUpdate } from "./learn";
import { place } from "./project";
import { chunkText, memoryText, retrieve, shortDoc } from "./retrieve";
import { capitalise } from "./text";
import { chunksFor, docMetaFor } from "./seed";
import type { SeedDocument } from "./corpus";

let counter = 0;
export function uid(prefix: string) {
  counter = (counter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const clone = <T,>(x: T): T => structuredClone(x);

function event(type: ActivityEvent["type"], at: number, title: string, detail: string, refId?: string): ActivityEvent {
  return { id: uid("ev"), type, at, title, detail, refId };
}

// ---------------------------------------------------------------------------------
// time

function endOfDay(t: number, plusDays = 0) {
  const d = new Date(t + plusDays * DAY);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

function expiryFor(text: string, now: number) {
  if (/\btomorrow\b/i.test(text)) return endOfDay(now, 1);
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/i.test(text)) return endOfDay(now);
  if (/\bthis week(end)?\b/i.test(text)) return endOfDay(now, 6);
  return now + DAY;
}

const fmtDay = (t: number) =>
  new Date(t).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/** Expire temporary memories whose time has passed. */
export function tick(world: World, now: number): { world: World; events: ActivityEvent[]; expired: string[] } {
  const due = world.memories.filter((m) => m.status === "current" && m.expiresAt && m.expiresAt <= now && !m.pinned);
  if (!due.length) return { world, events: [], expired: [] };
  const w = clone(world);
  const events: ActivityEvent[] = [];
  for (const m of w.memories) {
    if (due.some((x) => x.id === m.id)) {
      m.status = "expired";
      m.expiredAt = m.expiresAt;
      events.push(event("memory.expired", m.expiresAt!, "Temporary memory expired", m.text, m.id));
    }
  }
  w.events.push(...events);
  return { world: w, events, expired: due.map((m) => m.id) };
}

// ---------------------------------------------------------------------------------
// statements → memories

function knowledgeLine(world: World, cls: Classification, text: string, now: number): { label: string; line: string } {
  const def = slotDef(cls.slot);
  const v = cls.value ?? "";
  const dept = world.memories.find((m) => m.slot === "user.department" && m.status === "current")?.value;
  switch (def?.slot) {
    case "user.name":
      return { label: def.label, line: `Name: ${v}` };
    case "user.style":
      return {
        label: def.label,
        line: v === "concise" ? "Prefers concise answers" : v === "bullet points" ? "Prefers answers as bullet points" : "Prefers step-by-step explanations",
      };
    case "user.attendance":
      return { label: def.label, line: `Current attendance is ${v}` };
    case "user.department":
      return { label: def.label, line: `Studies ${v}` };
    case "event.exam": {
      const when = /tomorrow/.test(v) ? now + DAY : now;
      const what = v.replace(/\s*(today|tomorrow|tonight|this \w+)$/i, "");
      return { label: def.label, line: `Has a ${what} on ${fmtDay(when)}` };
    }
    case "attendance.minimum":
      return { label: def.label, line: `Minimum attendance = ${v}${cls.scope ? ` (${dept ?? "your"} department)` : ""}` };
    case "library.hours":
      return { label: def.label, line: v.startsWith("closes") ? `Library ${v.replace("closes", "closes at")}` : `Library open ${v}` };
    case "pass.marks":
      return { label: def.label, line: `Pass mark = ${v}` };
    case "hostel.curfew":
      return { label: def.label, line: `Hostel in-time is ${v}` };
  }
  const clean = capitalise(
    text
      .trim()
      .replace(/^(actually|fyi|note|btw|so|ok|okay|also)[,:]?\s+/i, "")
      .replace(/[.!]+$/, ""),
  );
  const topic =
    /\bdeadline/i.test(text) ? "Deadline" : /\bexam|quiz|test\b/i.test(text) ? "Exam" : /\bfee/i.test(text) ? "Fees" : /\bhostel/i.test(text) ? "Hostel" : /\blab\b/i.test(text) ? "Lab" : "Note";
  return { label: topic, line: clean };
}

function applyStatement(
  w: World,
  text: string,
  cls: Classification,
  now: number,
): { ops: MemoryOp[]; events: ActivityEvent[] } {
  const ops: MemoryOp[] = [];
  const events: ActivityEvent[] = [];
  const def = slotDef(cls.slot);

  if (cls.decision === "question" || cls.decision === "discard") {
    if (cls.decision === "discard") ops.push({ kind: "discard", title: "Not stored", detail: cls.reason });
    return { ops, events };
  }

  if (cls.decision === "reinforce") {
    const id = (() => {
      const m = w.memories.find((x) => x.slot === cls.slot && x.status === "current");
      return m?.id;
    })();
    const m = w.memories.find((x) => x.id === id);
    if (m) {
      m.uses.push(now);
      m.lastUsedAt = now;
      m.confidence = Math.min(0.98, Math.round((m.confidence + 0.04) * 100) / 100);
      ops.push({ kind: "reinforce", memoryId: m.id, title: m.text, detail: `Confirmed — confidence now ${m.confidence.toFixed(2)}` });
      events.push(event("memory.reinforced", now, "Memory reinforced", m.text, m.id));
    } else {
      ops.push({ kind: "reinforce", title: "Matches the documents", detail: "Already what the regulations say." });
    }
    return { ops, events };
  }

  if (cls.decision === "flag-previous") {
    // the last answer to an actual question — acknowledgements don't count
    const prev = [...w.turns].reverse().find((t) => {
      if (t.role !== "assistant" || !t.retrieval?.candidates.length) return false;
      const asked = w.turns.find((u) => u.id === t.replyTo);
      return !!asked?.classification?.isQuestion;
    });
    const cited = new Set((prev?.citations ?? []).map((c) => c.itemId));
    const target = prev?.retrieval?.candidates.find((c) => cited.has(c.id)) ?? prev?.retrieval?.candidates[0];
    if (prev && target) {
      const fb = feedbackOn(w, prev, "not_helpful", "wrong_source", target.id, now);
      prev.feedback = fb.feedback;
      events.push(...fb.events);
      ops.push({
        kind: "flag",
        previousId: target.id,
        subject: target.title,
        title: `Lowered trust in ${target.title}`,
        detail: fb.feedback.reliability
          ? `Reliability ${fb.feedback.reliability.from.toFixed(2)} → ${fb.feedback.reliability.to.toFixed(2)}`
          : undefined,
      });
    } else {
      ops.push({ kind: "flag", title: "Nothing to flag yet", detail: "There's no earlier answer to a question in this conversation." });
    }
    return { ops, events };
  }

  // store / replace / keep-temporarily
  const { label, line } = knowledgeLine(w, cls, text, now);
  const kind: Memory["kind"] = def?.kind ?? (cls.label === "temporary" ? "event" : "fact");
  const mcls = (cls.label === "irrelevant" ? "important" : cls.label) as Memory["cls"];
  const memory: Memory = {
    id: uid("mem"),
    slot: cls.slot && def?.value ? cls.slot : null,
    label,
    text: line,
    value: cls.value,
    scope: cls.scope,
    cls: mcls,
    kind,
    source: { type: "user", label: "You" },
    utterance: text.trim(),
    confidence: userConfidence(text, mcls, kind, !!cls.value),
    importance: importanceFor(mcls, kind),
    reliability: 1,
    status: "current",
    pinned: false,
    createdAt: now,
    lastUsedAt: now,
    uses: [],
  };
  if (cls.decision === "keep-temporarily") memory.expiresAt = expiryFor(text, now);

  let near: string | undefined;
  if (cls.decision === "replace" && cls.conflict) {
    const c = cls.conflict;
    memory.previousValue = c.withValue;
    if (c.withKind === "memory") {
      const old = w.memories.find((m) => m.id === c.withId);
      if (old) {
        old.status = "outdated";
        old.supersededBy = memory.id;
        old.supersededAt = now;
        memory.supersedes = old.id;
        near = old.id;
      }
    } else {
      const chunk = w.chunks.find((x) => x.id === c.withId);
      if (chunk && cls.slot) {
        chunk.overriddenBy = { ...(chunk.overriddenBy ?? {}), [cls.slot]: memory.id };
        memory.supersedes = `chunk:${chunk.id}`;
        near = chunk.id;
      }
    }
  }

  w.memories.push(memory);
  w.positions[memory.id] = place(
    { id: memory.id, text: memoryText(memory) },
    w.positions,
    [...w.chunks.map((c) => ({ id: c.id, text: chunkText(c) })), ...w.memories.filter((m) => m.id !== memory.id).map((m) => ({ id: m.id, text: memoryText(m) }))],
    near,
  );

  if (cls.decision === "replace" && cls.conflict) {
    const c = cls.conflict;
    ops.push({
      kind: "replace",
      memoryId: memory.id,
      previousId: c.withKind === "memory" ? c.withId : undefined,
      title: memory.text,
      detail: `Replaces “${c.withValue}” from ${c.withKind === "memory" ? "an earlier memory" : c.withSource}`,
    });
    const what =
      kind === "preference" ? "Preference updated" : kind === "profile" ? "Profile updated" : "Previous fact corrected";
    events.push(event("memory.replaced", now, what, `${label}: ${c.withValue} → ${memory.value ?? memory.text}`, memory.id));
  } else {
    ops.push({
      kind: "add",
      memoryId: memory.id,
      title: memory.text,
      detail:
        cls.decision === "keep-temporarily"
          ? `Kept until ${new Date(memory.expiresAt!).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })}`
          : `Stored as ${mcls} · confidence ${memory.confidence.toFixed(2)}`,
    });
    const title =
      kind === "preference"
        ? "Preference learned"
        : kind === "profile"
          ? "Profile learned"
          : mcls === "temporary"
            ? "Temporary memory kept"
            : "New knowledge added";
    events.push(event(kind === "preference" ? "memory.preference" : "memory.added", now, title, memory.text, memory.id));
  }
  return { ops, events };
}

// ---------------------------------------------------------------------------------
// the main loop

export function expandQuery(text: string, cls: Classification): string {
  const extra: string[] = [];
  if (/\b(fat|final assessment|finals?)\b/i.test(text)) extra.push("FAT eligibility minimum attendance requirement CAT");
  if (/\b(am i|can i|my)\b/i.test(text) && /\b(eligible|allowed|write|sit)\b/i.test(text)) extra.push("my current attendance");
  if (/\battendance\b/i.test(text) && !/\bmy attendance\b/i.test(text)) extra.push("minimum attendance requirement");
  if (!cls.isQuestion && cls.slotLabel) extra.push(cls.slotLabel);
  return extra.length ? `${text} ${extra.join(" ")}` : text;
}

export interface ProcessResult {
  world: World;
  user: Turn;
  assistant: Turn;
  ops: MemoryOp[];
  events: ActivityEvent[];
}

export function processMessage(world0: World, text: string, now: number): ProcessResult {
  const ticked = tick(world0, now);
  const w = clone(ticked.world);
  const events: ActivityEvent[] = [...ticked.events];

  const lastUser = [...w.turns].reverse().find((t) => t.role === "user" && t.classification?.slot);
  const lastAssistant = [...w.turns].reverse().find((t) => t.role === "assistant");
  const lastTopic =
    lastAssistant && lastUser && lastAssistant.at >= lastUser.at && (lastAssistant.intent?.startsWith("attendance") || lastAssistant.intent === "am-i-eligible")
      ? "attendance.minimum"
      : lastUser?.classification?.slot;

  const cls = classify(text, { world: w, lastTopic });
  const user: Turn = { id: uid("turn"), role: "user", text: text.trim(), at: now, classification: cls };

  const applied = applyStatement(w, text, cls, now);
  user.memoryOps = applied.ops;
  events.push(...applied.events);

  const query = expandQuery(text, cls);
  const retrieval = retrieve(w, query, w.weights, now);
  if (cls.isQuestion && /\d+\s*[+\-*x×/]\s*\d+/.test(text)) {
    // arithmetic needs no documents — answered directly
    retrieval.candidates = [];
    retrieval.excluded = [];
    retrieval.pool = 0;
  }
  const composed = compose(w, text, cls, retrieval, applied.ops, now);
  if (composed.lookups.length) {
    retrieval.candidates = [...retrieval.candidates, ...composed.lookups.map((c, i) => ({ ...c, rank: retrieval.candidates.length + i + 1 }))];
  }

  // citing a memory is a rehearsal: it resets its decay and stretches its half-life
  for (const c of composed.citations) {
    const m = w.memories.find((x) => x.id === c.itemId);
    if (m && m.status === "current" && m.createdAt < now) {
      m.uses.push(now);
      m.lastUsedAt = now;
    }
  }

  const assistant: Turn = {
    id: uid("turn"),
    role: "assistant",
    text: composed.text,
    at: now + 1,
    replyTo: user.id,
    retrieval,
    citations: composed.citations,
    intent: composed.intent,
    status: "done",
  };

  w.turns.push(user, assistant);
  w.queries.push(now);
  w.events.push(...applied.events);
  return { world: w, user, assistant, ops: applied.ops, events };
}

// ---------------------------------------------------------------------------------
// feedback

function feedbackOn(
  w: World,
  turn: Turn,
  verdict: Feedback["verdict"],
  reason: Feedback["reason"] | undefined,
  targetId: string | undefined,
  now: number,
): { feedback: Feedback; events: ActivityEvent[] } {
  const cands: Candidate[] = turn.retrieval?.candidates ?? [];
  const before: Weights = { ...w.weights };
  let after: Weights = before;
  let reliability: Feedback["reliability"];
  let label = "";

  const setReliability = (id: string, fn: (r: number) => number) => {
    const chunk = w.chunks.find((c) => c.id === id);
    const mem = w.memories.find((m) => m.id === id);
    const target = chunk ?? mem;
    if (!target) return;
    const from = target.reliability;
    target.reliability = fn(from);
    if (from !== target.reliability) reliability = { id, from, to: target.reliability };
  };

  if (verdict === "helpful") {
    const citedIds = new Set((turn.citations ?? []).map((c) => c.itemId));
    const cited = cands.filter((c) => citedIds.has(c.id));
    const others = cands.filter((c) => !citedIds.has(c.id));
    for (const c of cited) setReliability(c.id, raiseReliability);
    if (cited[0]) after = reinforceUpdate(before, cited[0], others);
    label = `Helpful: ${shortQuery(turn.retrieval?.query)}`;
  } else if (targetId && (reason === "wrong_source" || reason === "outdated")) {
    const rejected = cands.find((c) => c.id === targetId);
    const preferred = cands.find((c) => c.id !== targetId && !c.note?.startsWith("Looked up"));
    if (rejected && preferred) after = pairwiseUpdate(before, preferred, rejected);
    setReliability(targetId, reason === "outdated" ? (r) => Math.max(0.2, Math.round(r * 0.8 * 1000) / 1000) : lowerReliability);
    if (reason === "outdated") {
      const m = w.memories.find((x) => x.id === targetId && x.status === "current");
      if (m) {
        m.status = "outdated";
        m.supersededAt = now;
      }
    }
    label = `${reason === "outdated" ? "Outdated" : "Wrong source"}: ${rejected?.title ?? "source"}`;
  } else {
    label = "Not helpful: incomplete answer";
  }

  after = normalise(after);
  const d = deltas(before, after);
  const changed = Object.values(d).some((x) => Math.abs(x) >= 0.001);
  const events: ActivityEvent[] = [];
  if (changed) {
    w.weights = after;
    w.weightHistory.push({ at: now, weights: { ...after }, label });
    events.push(event("weights.updated", now, "Ranking weights updated", label));
  }
  if (reliability && reliability.to < reliability.from) {
    events.push(
      event("memory.flagged", now, "Source marked less reliable", `${titleFor(w, reliability.id)} · ${reliability.from.toFixed(2)} → ${reliability.to.toFixed(2)}`, reliability.id),
    );
  }
  // callers append `events` to the world's log
  return { feedback: { verdict, reason, targetId, deltas: d, reliability, at: now }, events };
}

function shortQuery(q?: string) {
  if (!q) return "answer";
  const s = q.split(/\s+/).slice(0, 7).join(" ");
  return s.length < q.length ? `${s}…` : s;
}

function titleFor(w: World, id: string) {
  const c = w.chunks.find((x) => x.id === id);
  if (c) return `${shortDoc(docTitle(w, c.docId))} §${c.section}`;
  return w.memories.find((m) => m.id === id)?.text ?? id;
}

export function applyFeedback(
  world: World,
  turnId: string,
  verdict: Feedback["verdict"],
  reason: Feedback["reason"] | undefined,
  targetId: string | undefined,
  now: number,
): { world: World; feedback: Feedback; events: ActivityEvent[] } {
  const w = clone(world);
  const turn = w.turns.find((t) => t.id === turnId);
  if (!turn) return { world, feedback: { verdict, reason, targetId, at: now }, events: [] };
  const res = feedbackOn(w, turn, verdict, reason, targetId, now);
  turn.feedback = res.feedback;
  w.events.push(...res.events);
  return { world: w, ...res };
}

// ---------------------------------------------------------------------------------
// direct memory actions

export function togglePin(world: World, id: string, now: number) {
  const w = clone(world);
  const m = w.memories.find((x) => x.id === id);
  if (!m) return { world, events: [] as ActivityEvent[] };
  m.pinned = !m.pinned;
  const e = event("memory.pinned", now, m.pinned ? "Memory pinned" : "Memory unpinned", m.text, m.id);
  w.events.push(e);
  return { world: w, events: [e] };
}

export function markOutdated(world: World, id: string, now: number) {
  const w = clone(world);
  const m = w.memories.find((x) => x.id === id);
  if (!m || m.status !== "current") return { world, events: [] as ActivityEvent[] };
  m.status = "outdated";
  m.supersededAt = now;
  if (m.supersedes?.startsWith("chunk:") && m.slot) {
    const chunk = w.chunks.find((c) => c.id === m.supersedes!.slice(6));
    if (chunk?.overriddenBy) delete chunk.overriddenBy[m.slot];
  }
  const e = event("memory.outdated", now, "Memory marked outdated", m.text, m.id);
  w.events.push(e);
  return { world: w, events: [e] };
}

export function deleteMemory(world: World, id: string, now: number) {
  const w = clone(world);
  const m = w.memories.find((x) => x.id === id);
  if (!m) return { world, events: [] as ActivityEvent[] };
  // deleting a replacement restores what it replaced
  if (m.supersedes?.startsWith("chunk:") && m.slot) {
    const chunk = w.chunks.find((c) => c.id === m.supersedes!.slice(6));
    if (chunk?.overriddenBy) delete chunk.overriddenBy[m.slot];
  } else if (m.supersedes && m.status === "current") {
    const prev = w.memories.find((x) => x.id === m.supersedes);
    if (prev) {
      prev.status = "current";
      prev.supersededBy = undefined;
      prev.supersededAt = undefined;
    }
  }
  w.memories = w.memories.filter((x) => x.id !== id);
  delete w.positions[id];
  const e = event("memory.deleted", now, "Memory deleted", m.text);
  w.events.push(e);
  return { world: w, events: [e] };
}

// ---------------------------------------------------------------------------------
// documents

export function parseUpload(name: string, raw: string, now: number): SeedDocument {
  const title = name.replace(/\.(md|txt|markdown)$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled document";
  const blocks: { title: string; text: string }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) {
      if (current?.lines.join(" ").trim()) blocks.push({ title: current.title, text: current.lines.join(" ").trim() });
      current = { title: h[1].trim(), lines: [] };
    } else {
      if (!current) current = { title: "", lines: [] };
      if (line.trim() === "" && current.lines.join(" ").split(/\s+/).length > 90) {
        blocks.push({ title: current.title, text: current.lines.join(" ").trim() });
        current = { title: current.title, lines: [] };
      } else current.lines.push(line.trim());
    }
  }
  if (current?.lines.join(" ").trim()) blocks.push({ title: current.title, text: current.lines.join(" ").trim() });

  // split long blocks into ~110-word chunks
  const sections: SeedDocument["sections"] = [];
  blocks.forEach((b) => {
    const words = b.text.split(/\s+/);
    for (let i = 0; i < words.length; i += 110) {
      const text = words.slice(i, i + 110).join(" ");
      const n = sections.length + 1;
      sections.push({
        section: String(n),
        title: b.title || text.split(/\s+/).slice(0, 5).join(" ") + "…",
        text,
        importance: 0.55,
      });
    }
  });
  // detect claims about known slots (e.g. an attendance percentage)
  for (const s of sections) {
    const claims = [];
    for (const slot of ["attendance.minimum", "library.hours", "pass.marks", "hostel.curfew"]) {
      const def = slotDef(slot);
      if (def?.value && def.topic.test(s.text)) {
        const v = def.value(s.text);
        if (v) claims.push({ slot, value: v.value, scope: v.scope });
      }
    }
    s.claims = claims;
  }
  return {
    id: `doc-${now.toString(36)}`,
    title,
    issuer: "Uploaded by you",
    published: new Date(now).toISOString().slice(0, 10),
    sections: sections.length ? sections : [{ section: "1", title, text: raw.slice(0, 800), importance: 0.5 }],
  };
}

export function ingest(world: World, doc: SeedDocument, now: number): { world: World; events: ActivityEvent[]; chunkIds: string[] } {
  const w = clone(world);
  if (w.documents.some((d) => d.id === doc.id)) return { world, events: [], chunkIds: [] };
  const chunks = chunksFor(doc, now);
  const meta = docMetaFor(doc, now, chunks);
  meta.sample = doc.id === "circular";
  w.documents.push(meta);
  const events: ActivityEvent[] = [event("document.indexed", now, "Document indexed", `${doc.title} · ${chunks.length} chunks`, doc.id)];

  for (const c of chunks) {
    w.chunks.push(c);
    w.positions[c.id] = place(
      { id: c.id, text: chunkText(c) },
      w.positions,
      [...w.chunks.filter((x) => x.id !== c.id).map((x) => ({ id: x.id, text: chunkText(x) })), ...w.memories.map((m) => ({ id: m.id, text: memoryText(m) }))],
    );
  }

  // reconcile the new document's claims with what is currently believed
  for (const c of chunks) {
    for (const claim of c.claims) {
      const def = slotDef(claim.slot);
      const mem = w.memories.find((m) => m.slot === claim.slot && m.status === "current");
      const norm = (s?: string) => s?.toLowerCase().replace(/\s+/g, "");
      if (mem && norm(mem.value) === norm(claim.value)) {
        const from = mem.confidence;
        mem.confidence = Math.max(mem.confidence, 0.95);
        mem.confirmedBy = c.id;
        events.push(
          event("memory.confirmed", now + 1, "Fact confirmed by a document", `${mem.text} · ${shortDoc(doc.title)} §${c.section} · confidence ${from.toFixed(2)} → ${mem.confidence.toFixed(2)}`, mem.id),
        );
        continue;
      }
      // the older document (or memory) that disagrees
      const older = w.chunks.find((x) => x.docId !== doc.id && x.claims.some((cl) => cl.slot === claim.slot) && !x.overriddenBy?.[claim.slot]);
      const olderValue = mem?.value ?? older?.claims.find((cl) => cl.slot === claim.slot)?.value;
      if (!olderValue || norm(olderValue) === norm(claim.value)) continue;
      const resolved: Memory = {
        id: uid("mem"),
        slot: claim.slot,
        label: def?.label ?? claim.slot,
        text: `${def?.label ?? claim.slot} = ${claim.value}${claim.scope ? " (CSE department)" : ""}`,
        value: claim.value,
        scope: claim.scope,
        cls: "correction",
        kind: "fact",
        source: { type: "document", label: shortDoc(doc.title), ref: c.id },
        confidence: 0.95,
        importance: 0.9,
        reliability: 1,
        status: "current",
        pinned: false,
        createdAt: now + 1,
        lastUsedAt: now + 1,
        uses: [],
        previousValue: olderValue,
        confirmedBy: c.id,
      };
      if (mem) {
        mem.status = "outdated";
        mem.supersededBy = resolved.id;
        mem.supersededAt = now + 1;
        resolved.supersedes = mem.id;
      } else if (older) {
        older.overriddenBy = { ...(older.overriddenBy ?? {}), [claim.slot]: resolved.id };
        resolved.supersedes = `chunk:${older.id}`;
      }
      w.memories.push(resolved);
      w.positions[resolved.id] = place({ id: resolved.id, text: memoryText(resolved) }, w.positions, [], mem?.id ?? older?.id);
      events.push(
        event(
          "document.conflict",
          now + 1,
          "Document conflict resolved",
          `${def?.label ?? claim.slot}: ${olderValue} → ${claim.value} (${shortDoc(doc.title)} §${c.section} is newer)`,
          resolved.id,
        ),
      );
    }
  }

  w.events.push(...events);
  return { world: w, events, chunkIds: chunks.map((c) => c.id) };
}
