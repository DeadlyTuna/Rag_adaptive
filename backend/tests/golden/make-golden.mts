// Runs the frontend's demo engine (the reference implementation) over a fixed script and
// records what it decided at every step. tests/test_parity.py replays the same script
// through the Python backend and compares.
//   node --import ./register.mjs make-golden.mts   (from backend/tests/golden)
import fs from "node:fs";
const E = "../../../frontend/lib/engine/";
const { createWorld } = await import(E + "seed.ts");
const { processMessage, applyFeedback, ingest, tick } = await import(E + "engine.ts");
const { SAMPLE_CIRCULAR } = await import(E + "corpus.ts");

export const T0 = Date.parse("2026-10-05T10:00:00");
export const SCRIPT = [
  "What is the minimum attendance requirement?",
  "Our department changed it to 80% last semester.",
  "When can I write my FAT?",
  "I prefer concise answers.",
  "I have a DBMS exam tomorrow.",
  "What's 2+2?",
  "My attendance is 78%.",
  "Am I eligible for FAT?",
  "How many marks do I need to pass?",
  "Actually, your previous answer was wrong.",
  "What are the library timings?",
  "My name is Harsh.",
  "Hello!",
  "The professor changed the deadline.",
];

let w = createWorld(T0);
const steps: any[] = [];
const turnByStep: string[] = [];
SCRIPT.forEach((text, i) => {
  const now = T0 + (i + 1) * 60_000;
  const r = processMessage(w, text, now);
  w = r.world;
  turnByStep.push(r.assistant.id);
  steps.push({
    kind: "message", text, now,
    classification: { label: r.user.classification!.label, decision: r.user.classification!.decision, slot: r.user.classification!.slot ?? null,
      value: r.user.classification!.value ?? null, probs: r.user.classification!.probs, conflict: r.user.classification!.conflict?.withId ?? null,
      coref: r.user.classification!.coref ?? null, spans: r.user.classification!.spans },
    ops: r.ops.map((o: any) => ({ kind: o.kind, title: o.title, detail: o.detail ?? null, memoryId: o.memoryId ?? null, previousId: o.previousId ?? null })),
    query: r.assistant.retrieval!.query,
    candidates: r.assistant.retrieval!.candidates.map((c: any) => ({ id: c.id, rank: c.rank, factors: c.factors, score: c.score, note: c.note ?? null })),
    excluded: r.assistant.retrieval!.excluded.map((c: any) => ({ id: c.id, excluded: c.excluded })),
    preferences: r.assistant.retrieval!.preferences.map((p: any) => p.id),
    answer: r.assistant.text, intent: r.assistant.intent, citations: r.assistant.citations,
    weights: w.weights,
  });
});
// feedback: helpful on "Am I eligible", wrong source on the library answer
const fbNow = T0 + 20 * 60_000;
let f = applyFeedback(w, turnByStep[7], "helpful", undefined, undefined, fbNow); w = f.world;
steps.push({ kind: "feedback", step: 7, verdict: "helpful", feedback: f.feedback, weights: w.weights });
const libTarget = w.turns.find((t: any) => t.id === turnByStep[10]).retrieval.candidates[0].id;
f = applyFeedback(w, turnByStep[10], "not_helpful", "wrong_source", libTarget, fbNow + 1000); w = f.world;
steps.push({ kind: "feedback", step: 10, verdict: "not_helpful", reason: "wrong_source", target: libTarget, feedback: f.feedback, weights: w.weights });
// a newer document that confirms the 80% rule
const ing = ingest(w, SAMPLE_CIRCULAR, T0 + 30 * 60_000); w = ing.world;
steps.push({ kind: "ingest", chunkIds: ing.chunkIds, events: ing.events.map((e: any) => ({ type: e.type, title: e.title, detail: e.detail })) });
// jump past the exam
const tk = tick(w, T0 + 3 * 86_400_000); w = tk.world;
steps.push({ kind: "tick", expired: tk.expired.length, events: tk.events.map((e: any) => e.type) });
steps.push({ kind: "final", memories: w.memories.map((m: any) => ({ id: m.id, slot: m.slot, text: m.text, value: m.value ?? null, status: m.status, confidence: m.confidence, reliability: m.reliability, cls: m.cls })),
  reliability: Object.fromEntries(w.chunks.filter((c: any) => c.reliability !== 1).map((c: any) => [c.id, c.reliability])),
  overrides: Object.fromEntries(w.chunks.filter((c: any) => c.overriddenBy && Object.keys(c.overriddenBy).length).map((c: any) => [c.id, c.overriddenBy])),
  weights: w.weights, weightHistory: w.weightHistory.length, events: w.events.length, queries: w.queries.length });

fs.writeFileSync("demo_script.json", JSON.stringify({ t0: T0, script: SCRIPT, steps }, null, 2));
console.log("wrote", steps.length, "steps; final answer:", steps[7].answer);
