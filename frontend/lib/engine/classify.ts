// Memory classifier: decides whether a message is worth remembering, and how.
// A feature-weighted scorer + softmax — transparent enough to show its work in the UI.

import type { Chunk, Classification, Conflict, Decision, Memory, MemoryClass, MemoryKind, Span, World } from "./types";
import { CLASSES } from "./types";
import { capitalise, isQuestion } from "./text";

// ---------------------------------------------------------------------------------
// Slots: the things a statement can be *about*. Same slot + different value = conflict.

export interface SlotDef {
  slot: string;
  label: string;
  kind: MemoryKind;
  user: boolean; // describes the user (profile/preference) rather than the world
  topic: RegExp;
  value?: (t: string) => { value: string; scope?: string } | null;
}

const PCT = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/i;
const TIME = /(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi;

function pct(t: string) {
  const m = t.match(PCT);
  return m ? `${m[1]}%` : null;
}

export const SLOTS: SlotDef[] = [
  {
    slot: "user.name",
    label: "Name",
    kind: "profile",
    user: true,
    topic: /\b(my name|call me|who am i)\b/i,
    value: (t) => {
      const m = t.match(/\bmy name is ([a-z][a-z'-]+)/i) ?? t.match(/\bcall me ([a-z][a-z'-]+)/i);
      return m ? { value: capitalise(m[1].toLowerCase()) } : null;
    },
  },
  {
    slot: "user.style",
    label: "Answer style",
    kind: "preference",
    user: true,
    topic: /\b(i prefer|my preference|answer style|keep (?:it|answers|replies) (?:short|brief|concise)|step[- ]by[- ]step|concise answers?)\b/i,
    value: (t) => {
      const m = t.match(
        /\b(?:prefer|like|want|keep|give me|use)\b[^.?!]*?\b(concise|short|brief|detailed|step[- ]by[- ]step|bullet(?:ed)?(?: points)?)\b/i,
      );
      if (!m) return null;
      const v = m[1].toLowerCase();
      if (/concise|short|brief/.test(v)) return { value: "concise" };
      if (/bullet/.test(v)) return { value: "bullet points" };
      return { value: "step-by-step" };
    },
  },
  {
    slot: "user.attendance",
    label: "Your attendance",
    kind: "profile",
    user: true,
    topic: /\bmy (current )?attendance\b/i,
    value: (t) => {
      const m = t.match(/\bmy (?:current )?attendance (?:is|was|=|:|stands at|is now|is at)?\s*(?:now\s+|at\s+|around\s+|about\s+)?(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)?/i);
      return m ? { value: `${m[1]}%` } : null;
    },
  },
  {
    slot: "user.department",
    label: "Department",
    kind: "profile",
    user: true,
    topic: /\b(i'?m|i am) (in|from) (the )?(cse|ece|eee|it|mech|civil|biotech)\b|\bmy (department|branch) is\b/i,
    value: (t) => {
      const m =
        t.match(/\b(?:i'?m|i am) (?:in|from) (?:the )?(cse|ece|eee|it|mech(?:anical)?|civil|biotech)\b/i) ??
        t.match(/\bmy (?:department|branch) is (\w+)/i);
      return m ? { value: m[1].toUpperCase() } : null;
    },
  },
  {
    slot: "event.exam",
    label: "Upcoming exam",
    kind: "event",
    user: true,
    topic: /\b(exam|quiz|test|viva|presentation)\b[^.?!]*\b(today|tomorrow|tonight|this (morning|afternoon|evening|week))\b/i,
    value: (t) => {
      const m = t.match(
        /\b(?:have|got|there'?s|writing)\s+(?:an?|my|the)?\s*([a-z]{2,10}\s)?(exam|quiz|test|viva|presentation)\b[^.?!]*?\b(today|tomorrow|tonight|this (?:morning|afternoon|evening|week))\b/i,
      );
      if (!m) return null;
      const subject = m[1] ? m[1].trim().toUpperCase() + " " : "";
      return { value: `${subject}${m[2].toLowerCase()} ${m[3].toLowerCase()}` };
    },
  },
  {
    slot: "attendance.minimum",
    label: "Minimum attendance",
    kind: "fact",
    user: false,
    topic: /\battendance\b/i,
    value: (t) => {
      if (/\bmy (current )?attendance\b/i.test(t)) return null;
      const v = pct(t);
      if (!v) return null;
      const scope = /\b(our|my|the|cse) (department|dept|branch)\b|\bdepartment\b/i.test(t) ? "department" : undefined;
      return { value: v, scope };
    },
  },
  {
    slot: "library.hours",
    label: "Library hours",
    kind: "fact",
    user: false,
    topic: /\blibrary\b/i,
    value: (t) => {
      const times = t.match(TIME);
      if (!times) return null;
      if (times.length >= 2) return { value: `${norm(times[0])} – ${norm(times[1])}` };
      return /\bclose|closes|closing|till|until\b/i.test(t) ? { value: `closes ${norm(times[0])}` } : null;
    },
  },
  {
    slot: "pass.marks",
    label: "Pass mark",
    kind: "fact",
    user: false,
    topic: /\bpass(ing)?\b[^.?!]*\bmarks?\b|\bmarks?\b[^.?!]*\bpass\b/i,
    value: (t) => {
      const m = t.match(/\b(\d{2})\b(?:\s*(?:marks|out of 100|\/100))?/i);
      return m ? { value: `${m[1]} marks` } : null;
    },
  },
  {
    slot: "hostel.curfew",
    label: "Hostel in-time",
    kind: "fact",
    user: false,
    topic: /\b(curfew|in-?time|hostel)\b/i,
    value: (t) => {
      const times = t.match(TIME);
      return times ? { value: norm(times[0]) } : null;
    },
  },
  {
    slot: "fat.eligibility",
    label: "FAT eligibility",
    kind: "fact",
    user: false,
    topic: /\b(fat|final assessment|finals?)\b/i,
  },
];

function norm(time: string) {
  return time.replace(/\s+/g, " ").toLowerCase().replace(/(\d)(am|pm)/, "$1 $2");
}

export function slotDef(slot: string | null | undefined): SlotDef | undefined {
  return slot ? SLOTS.find((s) => s.slot === slot) : undefined;
}

/** Topic of a message, even without a value (used for questions and coreference). */
export function detectTopic(text: string): SlotDef | undefined {
  return SLOTS.find((s) => s.topic.test(text));
}

// ---------------------------------------------------------------------------------
// Cue phrases

const CUES: Record<Exclude<MemoryClass, "irrelevant">, RegExp[]> & { irrelevant: RegExp[] } = {
  correction: [
    /\bactually\b/i,
    /^\s*no\b|\bnope\b/i,
    /\bnot (right|correct|true)\b/i,
    /\b(is|was|that'?s) (wrong|incorrect|outdated|old)\b/i,
    /\bincorrect\b/i,
    /\bchanged\b/i,
    /\b(updated|revised|raised|increased|lowered|reduced|moved|postponed|extended)\b/i,
    /\bnow (it'?s|it is)\b/i,
    /\bno longer\b|\bnot anymore\b/i,
    /\binstead\b/i,
  ],
  persistent: [
    /\bmy name is\b|\bcall me\b/i,
    /\b(i'?m|i am) (a|an|in|from)\b/i,
    /\bi (prefer|like|want|love)\b/i,
    /\bplease (always|keep|use|give)\b/i,
    /\balways\b/i,
    /\bmy (department|branch|major|semester|roll|year|attendance|cgpa|gpa|courses?)\b/i,
    /\bi study\b/i,
  ],
  important: [
    /\bdeadlines?\b/i,
    /\brules?\b|\bpolicy\b|\bregulations?\b/i,
    /\brequire(ment|d)?\b|\bmandatory\b|\bminimum\b/i,
    /\b(professor|prof|faculty|hod|dean|registrar|warden)\b/i,
    /\b(announced|notice|circular|official)\b/i,
    /\bchanged\b/i,
  ],
  temporary: [
    /\btoday\b/i,
    /\btomorrow\b/i,
    /\btonight\b/i,
    /\bthis (week|weekend|evening|morning|afternoon)\b/i,
    /\bright now\b|\bat the moment\b|\bfor now\b/i,
    /\bnext (class|hour|period)\b/i,
  ],
  irrelevant: [
    /^\s*(hi|hello|hey|thanks|thank you|ok|okay|cool|lol|bye|good (morning|night))\b/i,
    /\bweather\b/i,
    /\d+\s*[+\-*x×/]\s*\d+/i,
    /\bjoke\b/i,
    /\bhow are you\b/i,
  ],
};

const PREVIOUS_ANSWER = /\b(your|the) (previous|last|earlier) (answer|reply|response)\b|\bthat answer\b/i;
const AUTHORITY = /\b(department|dept|professor|prof|circular|official|notice|hod|dean|registrar|warden)\b/i;

const CUE_WEIGHT = { correction: 1.6, persistent: 2.2, important: 1.1, temporary: 2.6, irrelevant: 2.4 };
const CUE_CAP = { correction: 2, persistent: 1, important: 3, temporary: 1, irrelevant: 1 };

// ---------------------------------------------------------------------------------

export interface ClassifyContext {
  world: World;
  lastTopic?: string; // slot from the conversation so far (short-term memory)
}

function currentForSlot(world: World, slot: string): { kind: "memory"; m: Memory } | { kind: "chunk"; c: Chunk; value: string } | null {
  const m = world.memories.find((x) => x.slot === slot && x.status === "current");
  if (m) return { kind: "memory", m };
  for (const c of world.chunks) {
    const claim = c.claims.find((cl) => cl.slot === slot);
    if (claim && !c.overriddenBy?.[slot]) return { kind: "chunk", c, value: claim.value };
  }
  return null;
}

export function currentValue(world: World, slot: string): string | undefined {
  const cur = currentForSlot(world, slot);
  if (!cur) return undefined;
  return cur.kind === "memory" ? cur.m.value : cur.value;
}

function sameValue(a?: string, b?: string) {
  if (!a || !b) return false;
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/percent/, "%").trim();
  return n(a) === n(b);
}

function collectSpans(text: string, slot?: SlotDef): Span[] {
  const spans: Span[] = [];
  const push = (re: RegExp, kind: Span["kind"]) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      if (!m[0].trim()) break;
      spans.push({ start: m.index, end: m.index + m[0].length, kind, text: m[0] });
    }
  };
  push(/\d{1,3}(?:\.\d+)?\s*(?:%|percent)|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d+\s*[+\-*x×/]\s*\d+\b/i, "value");
  push(/\b(today|tomorrow|tonight|this (?:week|weekend|evening|morning|afternoon)|last semester|next week)\b/i, "time");
  push(/\b(actually|changed|wrong|incorrect|updated|revised|raised|prefer|always|no longer|instead)\b/i, "cue");
  if (slot) push(slot.topic, "topic");
  push(/\bmy name is ([A-Z][a-z]+)\b/, "entity");
  // keep non-overlapping, first come first served, ordered
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  let last = -1;
  for (const s of spans) {
    if (s.start >= last) {
      out.push(s);
      last = s.end;
    }
  }
  return out;
}

function softmax(logits: Record<MemoryClass, number>): Record<MemoryClass, number> {
  const max = Math.max(...CLASSES.map((c) => logits[c]));
  const exps = CLASSES.map((c) => Math.exp(logits[c] - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const out = {} as Record<MemoryClass, number>;
  CLASSES.forEach((c, i) => (out[c] = exps[i] / sum));
  return out;
}

export function classify(text: string, ctx: ClassifyContext): Classification {
  const { world } = ctx;
  const question = isQuestion(text);
  const logits: Record<MemoryClass, number> = { persistent: 0, important: 0, correction: 0, temporary: 0, irrelevant: 0.6 };

  for (const cls of CLASSES) {
    let hits = 0;
    for (const re of CUES[cls]) if (re.test(text)) hits++;
    logits[cls] += Math.min(hits, CUE_CAP[cls]) * CUE_WEIGHT[cls];
  }

  const hasValue = PCT.test(text) || /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(text) || /\b\d{2,3}\b/.test(text);
  if (hasValue) {
    logits.important += 0.5;
    logits.correction += 0.4;
  }
  if (!question && /\b(i|my|we|our)\b/i.test(text)) logits.persistent += 0.4;

  // --- slot + value, with coreference to the previous topic ("changed *it* to 80%")
  let def = SLOTS.find((s) => s.value && s.topic.test(text) && s.value(text));
  let coref: string | undefined;
  let extracted = def?.value?.(text) ?? null;
  if (!def && !question && ctx.lastTopic) {
    const prev = slotDef(ctx.lastTopic);
    if (prev?.value && /\b(it|that|this|the rule|the requirement|the limit)\b/i.test(text)) {
      const v = prev.value(text + " " + (prev.slot === "attendance.minimum" ? "attendance" : ""));
      if (v) {
        def = prev;
        extracted = v;
        coref = `“it” → ${prev.label.toLowerCase()} (from your previous question)`;
      }
    }
  }
  const topic = def ?? detectTopic(text);

  if (def && extracted) {
    if (def.kind === "event") logits.temporary += 0.8;
    else if (def.user) logits.persistent += 1.2;
    else logits.important += 0.8;
  }

  // --- conflict check against what is currently believed
  let conflict: Conflict | undefined;
  let reinforce: string | undefined;
  if (def && extracted && !question) {
    const cur = currentForSlot(world, def.slot);
    const curValue = cur ? (cur.kind === "memory" ? cur.m.value : cur.value) : undefined;
    if (cur && sameValue(curValue, extracted.value)) {
      reinforce = cur.kind === "memory" ? cur.m.id : cur.c.id;
    } else if (cur && curValue) {
      conflict =
        cur.kind === "memory"
          ? { withId: cur.m.id, withKind: "memory", withText: cur.m.text, withValue: curValue, withSource: cur.m.source.label }
          : {
              withId: cur.c.id,
              withKind: "document",
              withText: `${def.label} = ${curValue}`,
              withValue: curValue,
              withSource: `${docTitle(world, cur.c.docId)} §${cur.c.section}`,
            };
      if (!def.user) logits.correction += 2.8;
    }
  }

  const previousAnswer = PREVIOUS_ANSWER.test(text);
  if (previousAnswer) logits.correction += 2.5;

  // A correction needs something to correct.
  const correctionCues = CUES.correction.some((re) => re.test(text));
  if (correctionCues && !conflict && !previousAnswer) {
    logits.correction -= 1.2;
    logits.important += 1.0;
  }

  if (question) {
    logits.irrelevant += 1.6;
    for (const c of CLASSES) if (c !== "irrelevant") logits[c] -= 0.8;
  }

  const probs = softmax(logits);
  let label = CLASSES.reduce((a, b) => (probs[b] > probs[a] ? b : a));

  let decision: Decision;
  let reason: string;
  if (question && label === "irrelevant") {
    decision = "question";
    reason = "A question — nothing new to remember.";
  } else if (label === "irrelevant") {
    decision = "discard";
    reason = "Small talk or a one-off — not worth storing.";
  } else if (label === "correction" && previousAnswer && !extracted) {
    decision = "flag-previous";
    reason = "Flags the sources behind the previous answer as unreliable for this question.";
  } else if (conflict) {
    decision = "replace";
    reason = `Becomes the current value; “${conflict.withText}” is kept as history, marked outdated.`;
  } else if (reinforce) {
    decision = "reinforce";
    reason = "Already known — confirmed and strengthened.";
  } else if (label === "temporary") {
    decision = "keep-temporarily";
    reason = "Time-bound — kept until it no longer matters, then let go.";
  } else {
    if (label === "correction") label = "important";
    decision = "store";
    reason = label === "persistent" ? "Describes you — kept long-term." : "New knowledge — kept with high priority.";
  }

  return {
    label,
    probs,
    spans: collectSpans(text, topic),
    isQuestion: question,
    slot: topic?.slot,
    slotLabel: topic?.label,
    value: extracted?.value,
    scope: extracted?.scope,
    coref,
    conflict,
    decision,
    reason,
  };
}

export function docTitle(world: World, docId: string) {
  return world.documents.find((d) => d.id === docId)?.title ?? "Document";
}

/** Confidence for something the user just told us. 0.62 + 0.12 (specific value) + 0.08 (authority) = 0.82 */
export function userConfidence(text: string, cls: MemoryClass, kind: MemoryKind, hasValue: boolean): number {
  if (kind === "profile") return 0.9;
  if (kind === "preference") return 0.92;
  if (cls === "temporary") return 0.85;
  let c = 0.62;
  if (hasValue) c += 0.12;
  if (AUTHORITY.test(text)) c += 0.08;
  return Math.round(c * 100) / 100;
}

export function importanceFor(cls: MemoryClass, kind: MemoryKind): number {
  if (cls === "correction") return 0.9;
  if (cls === "important") return 0.85;
  if (cls === "temporary") return 0.5;
  return kind === "preference" ? 0.75 : 0.7;
}
