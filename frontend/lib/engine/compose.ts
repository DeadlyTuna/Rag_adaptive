// Answer generation for the demo engine. Templates per intent, filled from retrieved
// context, citing every source they use and honouring remembered preferences.
// (The real backend sends the same context to an LLM instead.)

import type { Candidate, Citation, Classification, Memory, MemoryOp, Retrieval, World } from "./types";
import { chunkCandidate, memoryCandidate } from "./retrieve";
import { similarity } from "./embed";
import { sentences } from "./text";
import { currentValue } from "./classify";

export interface Composed {
  text: string;
  citations: Citation[];
  intent: string;
  topic?: string;
  /** cited items that were not in the top-k (looked up by topic) */
  lookups: Candidate[];
}

type Style = "concise" | "step-by-step" | "bullet points" | undefined;

const DOC_ATT = "regs-3.1";
const DOC_CONDONE = "regs-3.2";
const DOC_DEBAR = "regs-3.3";
const DOC_ELIG = "regs-4.3";
const DOC_PASS = "regs-5.1";
const DOC_SCHED = "exams-6";
const DOC_LIB = "regs-9.1";
const DOC_CURFEW = "hostel-1";

function num(v?: string) {
  const m = v?.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

export function compose(
  world: World,
  userText: string,
  cls: Classification,
  retrieval: Retrieval,
  ops: MemoryOp[],
  now: number,
): Composed {
  const order: string[] = [];
  const cite = (id?: string | null) => {
    if (!id) return "";
    const exists = world.chunks.some((c) => c.id === id) || world.memories.some((m) => m.id === id);
    if (!exists) return "";
    let n = order.indexOf(id);
    if (n === -1) {
      order.push(id);
      n = order.length - 1;
    }
    return ` [${n + 1}]`;
  };
  const mem = (slot: string) => world.memories.find((m) => m.slot === slot && m.status === "current");
  const learnedFrom = (m: Memory) => (m.source.type === "user" ? "you told me it changed" : `according to ${m.source.label}`);
  const style: Style = mem("user.style")?.value as Style;
  const t = userText.trim();
  const lower = t.toLowerCase();

  // requirement: current belief about the attendance minimum + where it came from
  const reqMem = mem("attendance.minimum");
  const reqVal = currentValue(world, "attendance.minimum") ?? "75%";
  const docVal = world.chunks.find((c) => c.id === DOC_ATT)?.claims.find((c) => c.slot === "attendance.minimum")?.value ?? "75%";
  const reqSrc = reqMem ? reqMem.id : DOC_ATT;
  const reqIsLearned = !!reqMem && reqMem.value !== docVal;
  const deptRule = reqIsLearned ? "your department's" : "the";

  let text = "";
  let intent = "generic";

  const ack = (): string | null => {
    const op = ops[0];
    if (!op) return null;
    const m = world.memories.find((x) => x.id === op.memoryId);
    const prev = op.previousId ? world.memories.find((x) => x.id === op.previousId) : undefined;
    switch (cls.decision) {
      case "replace": {
        if (!m) return null;
        if (m.kind === "preference") {
          intent = "ack-preference";
          return m.value === "concise"
            ? `Noted — I'll keep answers short and to the point from now on${cite(m.id)}. Your earlier preference for ${m.previousValue} answers is kept as history${cite(prev?.id)}.`
            : `Noted — I'll use ${m.value} answers from now on${cite(m.id)}.`;
        }
        if (m.kind === "profile") {
          intent = "ack-profile";
          return `Updated — ${m.label.toLowerCase()} is now ${m.value} (it was ${m.previousValue})${cite(m.id)}.`;
        }
        intent = "ack-correction";
        const from = cls.conflict;
        const where = from?.withKind === "document" ? `${from.withSource}` : "what I had before";
        return `Got it — ${m.label.toLowerCase()} is now ${m.value}${m.scope ? " for your department" : ""}${cite(m.id)}. I've marked the earlier ${m.previousValue} from ${where} as outdated${cite(from?.withKind === "document" ? from.withId : prev?.id)}, so future answers will use ${m.value}.`;
      }
      case "store": {
        if (!m) return null;
        if (m.kind === "profile") {
          intent = "ack-profile";
          return `Thanks — I'll remember that ${m.label === "Your attendance" ? `your attendance is ${m.value}` : m.text.toLowerCase()}${cite(m.id)}.`;
        }
        if (m.kind === "preference") {
          intent = "ack-preference";
          return `Noted — I'll keep that in mind for every answer${cite(m.id)}.`;
        }
        intent = "ack-knowledge";
        return `Noted. I'll keep this with high priority${cite(m.id)}: “${m.text}”.`;
      }
      case "keep-temporarily": {
        if (!m) return null;
        intent = "ack-temporary";
        const until = new Date(m.expiresAt ?? now).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });
        return `Good luck! I'll keep that in mind until ${until}, then let it go${cite(m.id)}.`;
      }
      case "reinforce": {
        intent = "ack-reinforce";
        return `I already had that — I've marked it as confirmed${cite(op.memoryId ?? op.previousId)}.`;
      }
      case "flag-previous": {
        intent = "ack-flag";
        if (!op.subject) return "There's no earlier answer to flag yet — ask me something first.";
        return `Thanks for flagging it. I've lowered my trust in ${op.subject}${cite(op.previousId)} for questions like that. What's the correct information? I'll remember it.`;
      }
      default:
        return null;
    }
  };

  // ---------------------------------------------------------------- statements
  if (!cls.isQuestion) {
    const a = ack();
    if (a) text = a;
    else if (/^\s*(hi|hello|hey)\b/i.test(t)) {
      intent = "greeting";
      text = "Hi! Ask me about attendance, exams or hostel rules — or tell me something I should remember.";
    } else if (/^\s*(thanks|thank you)\b/i.test(t)) {
      intent = "thanks";
      text = "You're welcome.";
    } else {
      intent = "ack-discard";
      text = "Noted — that's not something I need to remember, so I haven't stored it.";
    }
    return finish(text, intent);
  }

  // ---------------------------------------------------------------- questions
  const arith = t.match(/(-?\d+(?:\.\d+)?)\s*([+\-*x×/])\s*(-?\d+(?:\.\d+)?)/);
  if (arith) {
    intent = "arithmetic";
    const a = parseFloat(arith[1]);
    const b = parseFloat(arith[3]);
    const op = arith[2];
    const r = op === "+" ? a + b : op === "-" ? a - b : op === "/" ? a / b : a * b;
    text = `${Number.isInteger(r) ? r : r.toFixed(2)}. That's not something I need to remember, so I didn't store it.`;
    return finish(text, intent);
  }

  if (/\b(what'?s|what is) my name\b|\bwho am i\b/i.test(t)) {
    intent = "name";
    const m = mem("user.name");
    text = m ? `You're ${m.value}${cite(m.id)}.` : "You haven't told me your name yet.";
    return finish(text, intent);
  }

  if (/\bwhat'?s my attendance\b|\bwhat is my attendance\b/i.test(t)) {
    intent = "my-attendance";
    const m = mem("user.attendance");
    text = m ? `You told me your attendance is ${m.value}${cite(m.id)}.` : "You haven't told me your attendance yet.";
    return finish(text, intent);
  }

  const aboutFat = /\b(fat|final assessment|finals?)\b/i.test(lower);

  if (aboutFat && /\b(am i (eligible|allowed)|can i (write|sit|appear))\b/i.test(t) && !/^\s*when\b/i.test(t)) {
    intent = "am-i-eligible";
    const ua = mem("user.attendance");
    if (!ua) {
      text = `You're eligible if your attendance is at least ${reqVal}${cite(reqSrc)} and you've attempted at least one CAT${cite(DOC_ELIG)}. Tell me your current attendance and I'll check.`;
    } else if (num(ua.value) >= num(reqVal)) {
      text = `Yes — your attendance of ${ua.value}${cite(ua.id)} meets ${deptRule} ${reqVal} minimum${cite(reqSrc)}. As long as you've attempted at least one CAT${cite(DOC_ELIG)}, you can write the FAT.`;
    } else {
      const wouldHave = reqIsLearned && num(ua.value) >= num(docVal);
      if (style === "concise") {
        text = `Not yet. Your ${ua.value}${cite(ua.id)} is below ${deptRule} ${reqVal} minimum${cite(reqSrc)}, so you'd be debarred from the FAT${cite(DOC_DEBAR)}.`;
      } else if (style === "step-by-step") {
        text =
          `Not yet — here's the check:\n` +
          `1. Your attendance is ${ua.value}${cite(ua.id)}.\n` +
          `2. The minimum is ${reqVal}${cite(reqSrc)}${reqIsLearned ? `, your department's rule rather than the university's ${docVal}` : ""}.\n` +
          `3. ${ua.value} is below ${reqVal}, so you'd be debarred from the FAT${cite(DOC_DEBAR)} unless you raise it or get medical condonation${cite(DOC_CONDONE)}.`;
      } else {
        text = `Not yet. Your attendance is ${ua.value}${cite(ua.id)}, below ${deptRule} ${reqVal} minimum${cite(reqSrc)}, so as things stand you'd be debarred from the FAT${cite(DOC_DEBAR)}.${wouldHave ? ` Under the university's ${docVal} rule you would have qualified — the department's change is what rules you out.` : ""} If the shortfall is for medical reasons, you can apply for condonation through your HoD${cite(DOC_CONDONE)}.`;
      }
      if (wouldHave && style === "step-by-step") {
        text += `\n(Under the university's ${docVal} rule you would have qualified — the department's change is what rules you out.)`;
      }
    }
    return finish(text, intent, "attendance.minimum");
  }

  if (aboutFat) {
    intent = "fat-eligibility";
    const sched = retrieval.candidates.some((c) => c.id === DOC_SCHED) ? DOC_SCHED : null;
    if (style === "concise") {
      text = `Once you have at least ${reqVal} attendance in the course${cite(reqSrc)} and have attempted one CAT${cite(DOC_ELIG)}.${sched ? ` FATs start on 17 November${cite(sched)}.` : ""}`;
    } else if (style === "step-by-step") {
      text =
        `You can write a course's FAT when both conditions are met:\n` +
        `1. Attendance of at least ${reqVal} in that course${cite(reqSrc)}${reqIsLearned ? ` — your department's rule, not the university's ${docVal}${cite(DOC_ATT)}` : ""}.\n` +
        `2. At least one of CAT-1 and CAT-2 attempted${cite(DOC_ELIG)}.` +
        (sched ? `\nThis semester's FATs start on 17 November${cite(sched)}.` : "");
    } else {
      text = `You can write a course's FAT once you have at least ${reqVal} attendance in it${cite(reqSrc)}${reqIsLearned ? ` (your department's rule)` : ""} and have attempted at least one CAT${cite(DOC_ELIG)}.${sched ? ` This semester's FATs start on 17 November${cite(sched)}.` : ""}`;
    }
    return finish(text, intent, "fat.eligibility");
  }

  if (/\battendance\b/i.test(t) && !/\bmy attendance\b/i.test(t)) {
    intent = "attendance-minimum";
    if (reqIsLearned && reqMem) {
      if (style === "concise") {
        text = `${reqVal} — your department's rule${cite(reqMem.id)}, which replaces the university's ${docVal}${cite(DOC_ATT)}.`;
      } else if (style === "step-by-step") {
        text =
          `Here's how it works out:\n` +
          `1. The university regulation sets the minimum at ${docVal}${cite(DOC_ATT)}.\n` +
          `2. ${reqMem.source.type === "user" ? "You told me your department raised it" : `${reqMem.source.label} raised it`} to ${reqVal}${cite(reqMem.id)}, so I treat ${reqVal} as the current rule.\n` +
          `3. You need at least ${reqVal} in every course — theory and lab are counted separately.`;
      } else {
        text = `The minimum attendance is ${reqVal}${cite(reqMem.id)} — your department's rule, which replaces the university's ${docVal}${cite(DOC_ATT)}. Theory and lab attendance are counted separately.`;
      }
    } else if (style === "concise") {
      text = `${reqVal} in every course${cite(DOC_ATT)}.`;
    } else if (style === "step-by-step") {
      text =
        `1. The minimum attendance is ${reqVal} in every course${cite(DOC_ATT)}.\n` +
        `2. Theory and lab attendance are counted separately.\n` +
        `3. Below the minimum, you're debarred from that course's FAT${cite(DOC_DEBAR)}.`;
    } else {
      text = `The minimum attendance requirement is ${reqVal} in every course${cite(DOC_ATT)}. If you fall below it, you're debarred from that course's FAT${cite(DOC_DEBAR)}.`;
    }
    return finish(text, intent, "attendance.minimum");
  }

  if (/\bpass(ing)?\b/i.test(t) && /\bmarks?|score\b/i.test(t)) {
    intent = "pass-marks";
    const top = retrieval.candidates[0];
    const m = mem("pass.marks");
    if (m) {
      text = `The pass mark is now ${m.value}${cite(m.id)} — ${learnedFrom(m)}; the regulations say 50 out of 100${cite(DOC_PASS)}. You also need at least 40 in the FAT.`;
    } else if (top && top.id !== DOC_PASS && top.kind === "document") {
      // Answer from the top-ranked passage — so a bad ranking shows up as a bad answer.
      text = `${bestSentence(top.text, t)}${cite(top.id)}`;
    } else {
      text =
        style === "concise"
          ? `50 out of 100 overall, with at least 40 in the FAT${cite(DOC_PASS)}.`
          : `You need at least 50 out of 100 in the course total and at least 40 out of 100 in the FAT${cite(DOC_PASS)}.`;
    }
    return finish(text, intent, "pass.marks");
  }

  if (/\blibrary\b/i.test(t)) {
    intent = "library-hours";
    const m = mem("library.hours");
    text = m
      ? `On weekdays the library now ${(m.value ?? "").replace(/^closes\b/, "closes at")}${cite(m.id)} — you told me it changed; the regulations still say 8 am to 8 pm${cite(DOC_LIB)}. On Saturdays it's open 9 am to 5 pm.`
      : `The central library is open 8 am to 8 pm on weekdays and 9 am to 5 pm on Saturdays${cite(DOC_LIB)}.`;
    return finish(text, intent, "library.hours");
  }

  if (/\b(curfew|in-?time|back (to|in) the hostel|hostel)\b/i.test(t) && /\b(time|when|by|curfew|late)\b/i.test(t)) {
    intent = "curfew";
    const m = mem("hostel.curfew");
    text = m
      ? `Residents now need to be back in the hostel by ${m.value}${cite(m.id)} — ${learnedFrom(m)}; the hostel handbook says 9:30 pm${cite(DOC_CURFEW)}.`
      : `Residents need to be back in the hostel by 9:30 pm every day${cite(DOC_CURFEW)}.`;
    return finish(text, intent, "hostel.curfew");
  }

  // ---------------------------------------------------------------- generic
  const top = retrieval.candidates.filter((c) => c.factors.S >= 0.3);
  if (!top.length) {
    intent = "no-answer";
    text = "I couldn't find that in the documents or in what you've told me. Add a document on the Knowledge page, or tell me the answer and I'll remember it.";
    return finish(text, intent);
  }
  intent = "generic";
  const parts = top.slice(0, style === "concise" ? 1 : 2).map((c) => {
    const s = c.kind === "memory" ? `You told me: ${c.title}.` : bestSentence(c.text, t);
    return `${s}${cite(c.id)}`;
  });
  text =
    style === "step-by-step" && parts.length > 1
      ? parts.map((p, i) => `${i + 1}. ${p}`).join("\n")
      : parts.join(" ");
  return finish(text, intent);

  // ----------------------------------------------------------------
  function finish(body: string, why: string, topic?: string): Composed {
    const citations: Citation[] = order.map((id, i) => ({ n: i + 1, itemId: id }));
    const have = new Set(retrieval.candidates.map((c) => c.id));
    const lookups: Candidate[] = [];
    for (const id of order) {
      if (have.has(id)) continue;
      const chunk = world.chunks.find((c) => c.id === id);
      const m = world.memories.find((x) => x.id === id);
      const cand = chunk ? chunkCandidate(world, chunk, retrieval.query, now) : m ? memoryCandidate(m as Memory, retrieval.query, now) : null;
      if (!cand) continue;
      const w = retrieval.weights;
      cand.score = Math.round((w.S * cand.factors.S + w.R * cand.factors.R + w.C * cand.factors.C + w.I * cand.factors.I) * 1000) / 1000;
      cand.note = cand.note ?? "Looked up by topic";
      lookups.push(cand);
    }
    return { text: body.trim(), citations, intent: why, topic, lookups };
  }
}

function bestSentence(text: string, query: string): string {
  const ss = sentences(text);
  let best = ss[0] ?? text;
  let bestS = -1;
  for (const s of ss) {
    const sim = similarity(query, s);
    if (sim > bestS) {
      bestS = sim;
      best = s;
    }
  }
  return best.replace(/\s+$/, "");
}
