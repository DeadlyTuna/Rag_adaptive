"use client";

// The research extensions (backend/app/novelty) and the benchmark that measures them.
// With the FastAPI backend connected, every section shows live state; without it, the
// page still shows what the extensions do and the benchmark results measured offline.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Ban, RefreshCw } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/motion-bits";
import { FACTOR_META } from "@/lib/factors";
import { FACTORS } from "@/lib/engine/types";
import { DAY } from "@/lib/engine/forget";
import { cx, dayYear } from "@/lib/format";
import { LIVE, live, type BenchmarkSummary, type Research, type Resolved } from "@/lib/api/live";
import { useHydrated, useNow, useStore } from "@/lib/store";
import offline from "@/lib/research/benchmark.json";

const SHORT: Record<string, string> = {
  uptake: "Uptake",
  persistence: "Persists",
  poisoning: "Poison",
  cross_user: "Cross-student",
  scope: "Scope",
  time: "Time",
  privacy: "Privacy",
  expiry: "Expiry",
  clarify: "Asks",
  abstain: "Declines",
  answerable: "Answers",
};
const WITHOUT: Record<string, string> = { no_memory: "without memories", no_feedback: "without feedback learning", plain: "as plain RAG" };

const CATEGORY: [string, string][] = [
  ["uptake", "Correction uptake"],
  ["persistence", "Correction persistence"],
  ["poisoning", "Poisoning resisted"],
  ["cross_user", "Cross-student poisoning resisted"],
  ["scope", "Scope accuracy"],
  ["time", "Time accuracy"],
  ["privacy", "Privacy kept"],
  ["expiry", "Expiry handled"],
  ["clarify", "Asks when it depends"],
  ["abstain", "Unanswerable → declined"],
  ["answerable", "Answerable → answered"],
];

const NOVELTIES: { n: number; key: string; title: string; body: string; where?: { href: string; label: string } }[] = [
  {
    n: 1,
    key: "scope_time",
    title: "Scope- and time-aware facts",
    body: "A fact carries the department it applies to and when it was true. “Our department raised it to 80%” changes the answer for CSE only; “What was it last year?” is answered from history; “From 1 December …” takes effect on 1 December.",
    where: { href: "/console", label: "Ask about another department or the past" },
  },
  {
    n: 2,
    key: "intent_weights",
    title: "Ranking weights per question type",
    body: "Feedback on a deadline question trains the weights for time questions, not for everything. Retrieval blends the type's weights with the global ones, λ = k / (k + n): no evidence means global weights; the type takes over as its feedback grows.",
  },
  {
    n: 3,
    key: "verify",
    title: "Verified corrections, learned trust",
    body: "A correction that contradicts a reliable document is scored — the student's track record, an authority cue, whether it is scoped, how big the change is. Below the bar it is held as unverified until a document, other students or a moderator confirm it.",
    where: { href: "/memory", label: "See unverified memories" },
  },
  {
    n: 4,
    key: "counterfactual",
    title: "Counterfactual answers",
    body: "Any answer can be re-asked without memories, without feedback learning, or as plain RAG — showing exactly which kind of adaptation changed it.",
    where: { href: "/console", label: "Open an answer → “What if it hadn’t learned?”" },
  },
  {
    n: 5,
    key: "learned_decay",
    title: "Forgetting rates learned from use",
    body: "How fast each kind of memory fades is fitted from how often memories actually get reused — a right-censored exponential estimate, shrunk towards the hand-set rate when there is little data.",
  },
  {
    n: 6,
    key: "answerability",
    title: "Confidence, clarifying questions, abstaining",
    body: "Every answer gets a confidence from its evidence. When the answer depends on something unknown (which department?) it asks; when nothing relevant was found for an open question it says so instead of guessing.",
  },
  {
    n: 7,
    key: "consolidate",
    title: "Consolidation",
    body: "Overnight (or on demand) memories that say the same thing are merged and faded ones are archived — they stay listed and can be restored.",
    where: { href: "/memory", label: "Consolidate on the memory page" },
  },
  {
    n: 8,
    key: "multi_user",
    title: "Private memories, crowd-verified facts",
    body: "Each student's personal facts stay private. A rule one student reports changes only their answers until enough students (or a document) confirm it — then it is shared with everyone it applies to.",
  },
  {
    n: 9,
    key: "propagation",
    title: "Trust propagation",
    body: "When a passage is marked outdated, its closest neighbours in the same document lose a little reliability too — rules go out of date an edition at a time.",
  },
  {
    n: 10,
    key: "staleness",
    title: "Staleness map",
    body: "The knowledge terrain can be coloured by how stale each part is: old, overridden, distrusted or fading knowledge glows warm.",
    where: { href: "/memory", label: "Memory → Map colour: Staleness" },
  },
  {
    n: 11,
    key: "reminders",
    title: "Proactive reminders",
    body: "“I have a DBMS exam tomorrow” schedules reminders for the evening before and the morning of; they arrive as notifications when their time comes.",
  },
  {
    n: 12,
    key: "benchmark",
    title: "A benchmark with ablations",
    body: "Scripted conversations with probes compare plain RAG, the core system and the extensions — and switch each extension off in turn to show what it is responsible for.",
  },
];

const days = (ms: number) => `${(ms / DAY).toFixed(ms < 10 * DAY ? 1 : 0)} d`;

function useResearch() {
  const student = useStore((s) => s.student);
  const version = useStore((s) => s.world.events.length + s.world.memories.length);
  const [data, setData] = useState<Research | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!LIVE) return;
    live
      .research(student)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [student]);
  useEffect(() => {
    load();
  }, [load, version]);
  return { data, error, reload: load };
}

// ------------------------------------------------------------------ benchmark

function Cell({ c, base }: { c?: { correct: number; total: number }; base?: { correct: number; total: number } }) {
  if (!c) return <td className="px-2 py-1.5 text-kelp">–</td>;
  const worse = base && c.correct < base.correct;
  const full = c.correct === c.total;
  return (
    <td className={cx("tnum px-2 py-1.5 text-right", worse ? "text-sodium" : full ? "text-foam" : "text-kelp")}>
      {c.correct}/{c.total}
    </td>
  );
}

function Benchmark({ b }: { b: BenchmarkSummary }) {
  const systems = Object.keys(b.main);
  const all = b.main["+novelties"];
  const x = b.experiments;
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-b hairline text-left">
              <th className="label px-2 py-2 font-normal">What is measured</th>
              {systems.map((s) => (
                <th key={s} className="label px-2 py-2 text-right font-normal">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY.filter(([k]) => all?.[k]).map(([k, label]) => (
              <tr key={k} className="border-b hairline last:border-0">
                <td className="px-2 py-1.5 text-foam">{label}</td>
                {systems.map((s) => (
                  <Cell key={s} c={b.main[s][k]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] text-kelp">
          <b className="font-[600] text-foam">plain</b> is ordinary RAG (documents only, nothing remembered or learned) ·{" "}
          <b className="font-[600] text-foam">adaptive</b> the core system · <b className="font-[600] text-foam">+novelties</b> adds every extension. Hashed
          embeddings and template answers, so every run gives the same numbers ({b.seconds} s).
        </p>
      </div>

      <div className="overflow-x-auto">
        <p className="mb-2 text-[13px] font-[600] text-foam">Ablations — every extension but one</p>
        <table className="w-full min-w-[760px] text-[12.5px]">
          <thead>
            <tr className="border-b hairline text-left">
              <th className="label px-2 py-2 font-normal">Without</th>
              {CATEGORY.filter(([k]) => all?.[k]).map(([k, label]) => (
                <th key={k} className="label px-2 py-2 text-right font-normal" title={label}>
                  {SHORT[k] ?? label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(b.ablations).map(([s, t]) => (
              <tr key={s} className="border-b hairline last:border-0">
                <td className="px-2 py-1.5 text-foam">{s.replace(/^−/, "").replace(/_/g, " ")}</td>
                {CATEGORY.filter(([k]) => all?.[k]).map(([k]) => (
                  <Cell key={k} c={t[k]} base={all[k]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] text-kelp">Cells in amber drop below the all-on system: that extension is what those probes depend on.</p>
      </div>

      {x && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[13px] font-[600] text-foam">Ranking with per-question-type weights</p>
            <table className="w-full text-[12.5px]">
              <tbody>
                {Object.entries(x.ranking)
                  .filter(([k]) => !k.startsWith("_"))
                  .map(([k, v]) => {
                    const r = v as { mrr: number; "hit@1": number };
                    return (
                      <tr key={k} className="border-b hairline last:border-0">
                        <td className="py-1.5 text-foam">{k}</td>
                        <td className="tnum py-1.5 text-right text-kelp">MRR {r.mrr.toFixed(3)}</td>
                        <td className="tnum py-1.5 text-right text-kelp">hit@1 {r["hit@1"].toFixed(3)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="mt-1.5 text-[11.5px] text-kelp">{String(x.ranking._about)}.</p>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-[600] text-foam">Learned forgetting rates (synthetic reuse)</p>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left">
                  <th className="label py-1 font-normal">Class</th>
                  <th className="label py-1 text-right font-normal">true gap</th>
                  <th className="label py-1 text-right font-normal">hand-set τ</th>
                  <th className="label py-1 text-right font-normal">learned τ</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(x.forgetting.trueMeanGapDays).map((c) => (
                  <tr key={c} className="border-t hairline">
                    <td className="py-1.5 text-foam">{c}</td>
                    <td className="tnum py-1.5 text-right text-kelp">{x.forgetting.trueMeanGapDays[c]} d</td>
                    <td className="tnum py-1.5 text-right text-kelp">{x.forgetting.handSetTauDays[c]} d</td>
                    <td className="tnum py-1.5 text-right text-foam">{x.forgetting.learnedTauDays[c]} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1.5 text-[11.5px] text-kelp">
              Held-out log-likelihood:{" "}
              {Object.entries(x.forgetting.heldoutLogLik)
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ")}{" "}
              (higher is better).
            </p>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-[600] text-foam">Consolidation</p>
            {Object.entries(x.consolidation)
              .filter(([k]) => !k.startsWith("_"))
              .map(([k, v]) => {
                const r = v as { currentMemoriesBefore: number; currentMemoriesAfter: number; merged: number; copiesOfTheAnswerInTop5: number };
                return (
                  <p key={k} className="text-[12.5px] text-kelp">
                    <span className="text-foam">{k}</span>: {r.currentMemoriesBefore} → {r.currentMemoriesAfter} current memories after a night,{" "}
                    {r.merged} merged, {r.copiesOfTheAnswerInTop5} copies of the answer in the top 5
                  </p>
                );
              })}
          </div>
          <div>
            <p className="mb-2 text-[13px] font-[600] text-foam">Counterfactual attribution (demo conversation)</p>
            <p className="text-[12.5px] text-kelp">
              Of {x.counterfactual.questions} answers,{" "}
              {Object.entries(x.counterfactual.answersThatChangeWithout)
                .map(([k, v]) => `${v} change ${WITHOUT[k] ?? k}`)
                .join(", ")}
              .
            </p>
            {b.calibration && (
              <>
                <p className="mb-2 mt-4 text-[13px] font-[600] text-foam">Is the confidence informative?</p>
                <p className="text-[12.5px] text-kelp">
                  Mean confidence {b.calibration.meanConfidenceRight} on right answers vs {b.calibration.meanConfidenceWrong} on wrong ones · AUROC{" "}
                  {b.calibration.auroc} over {b.calibration.answers} answers (0.5 = no signal).
                </p>
              </>
            )}
          </div>
          <div>
            <p className="mb-2 text-[13px] font-[600] text-foam">Trust propagation</p>
            <p className="text-[12.5px] text-kelp">
              {x.propagation.feedback}:{" "}
              {Object.entries(x.propagation.reliabilityChanged)
                .map(([id, [a, b2]]) => `${id} ${a.toFixed(2)} → ${b2.toFixed(2)}`)
                .join(" · ")}
            </p>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-[600] text-foam">Staleness and reminders</p>
            <p className="text-[12.5px] text-kelp">
              Mean staleness: overridden passages {x.staleness.overriddenPassages}, distrusted {x.staleness.lowReliabilityPassages}, the rest{" "}
              {x.staleness.otherPassages}. Reminders: {x.reminders.cases.reduce((a, c) => a + c.fired, 0)} fired of{" "}
              {x.reminders.cases.reduce((a, c) => a + c.expected, 0)} expected across {x.reminders.cases.length} cases.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ live sections

function WeightsByType({ r }: { r: Research }) {
  return (
    <div className="space-y-3">
      {Object.entries(r.intentWeights).map(([g, v]) => (
        <div key={g}>
          <p className="flex items-baseline justify-between text-[12.5px]">
            <span className="text-foam">{v.label}</span>
            <span className="data text-kelp">
              {v.feedback} feedback · {Math.round(v.groupShare * 100)}% own
            </span>
          </p>
          <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full">
            {FACTORS.map((f) => (
              <span key={f} title={`${FACTOR_META[f].name} ${v.effective[f].toFixed(3)}`} style={{ width: `${v.effective[f] * 100}%`, background: FACTOR_META[f].color }} />
            ))}
          </div>
        </div>
      ))}
      <p className="flex flex-wrap gap-3 pt-1 text-[11.5px] text-kelp">
        {FACTORS.map((f) => (
          <span key={f} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: FACTOR_META[f].color }} />
            {FACTOR_META[f].name}
          </span>
        ))}
        <span>· shrinkage k = {r.shrinkageK}</span>
      </p>
    </div>
  );
}

function Trust({ r }: { r: Research }) {
  const verify = useStore((s) => s.verifyMemory);
  const busy = useStore((s) => !!s.pending);
  return (
    <div className="space-y-4">
      <ul className="space-y-2.5">
        {Object.entries(r.trust).map(([id, t]) => (
          <li key={id}>
            <p className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-foam">
                {t.name} {t.department ? <span className="text-kelp">· {t.department}</span> : null}
              </span>
              <span className="data text-kelp">
                trust {t.mean.toFixed(2)} · Beta({t.alpha}, {t.beta})
              </span>
            </p>
            <Meter value={t.mean} tone={t.mean >= r.verification.threshold ? "var(--color-glacier)" : "var(--color-sodium)"} className="mt-1.5" />
          </li>
        ))}
      </ul>
      <div>
        <p className="label mb-2">Held for verification · needs {r.verification.threshold.toFixed(2)} · or {r.verification.crowdK} students</p>
        {r.pending.length === 0 ? (
          <p className="text-[12.5px] text-kelp">Nothing waiting. Try “The minimum attendance requirement is 5%.” in the console.</p>
        ) : (
          <ul className="space-y-2">
            {r.pending.map((m) => (
              <li key={m.id} className="rounded-[10px] border border-shelf bg-abyss/40 px-3 py-2">
                <p className="text-[13px] text-foam">{m.text}</p>
                <p className="mt-0.5 text-[11.5px] text-kelp">
                  {m.owner ?? "harsh"} · score {m.verification?.score.toFixed(2)} · contradicts {m.verification?.againstValue}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => verify(m.id, true)}>
                    <Check size={13} /> Accept
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => verify(m.id, false)}>
                    <Ban size={13} /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Forgetting({ r }: { r: Research }) {
  return (
    <div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left">
            <th className="label py-1 font-normal">Class</th>
            <th className="label py-1 text-right font-normal">hand-set τ</th>
            <th className="label py-1 text-right font-normal">learned τ</th>
            <th className="label py-1 text-right font-normal">reuses seen</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(r.decay).map(([c, f]) => (
            <tr key={c} className="border-t hairline">
              <td className="py-1.5 text-foam">{c}</td>
              <td className="tnum py-1.5 text-right text-kelp">{days(f.prior)}</td>
              <td className="tnum py-1.5 text-right text-foam">{days(f.tau)}</td>
              <td className="tnum py-1.5 text-right text-kelp">
                {f.events} in {f.memories}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] text-kelp">
        {r.decayInUse ? "In use: memory strength and the forgetting curves use the learned τ." : "Shown for comparison — learned decay is switched off."}
      </p>
    </div>
  );
}

function Reminders({ r }: { r: Research }) {
  const now = useNow(30_000);
  const [hidden, setHidden] = useState<string[]>([]);
  const list = r.reminders.filter((x) => x.status !== "cancelled" && !hidden.includes(x.id));
  if (!list.length) return <p className="text-[12.5px] text-kelp">None yet. Tell the console “I have a DBMS exam tomorrow.”</p>;
  return (
    <ul className="space-y-2">
      {list.map((x) => (
        <li key={x.id} className="flex items-start gap-3 rounded-[10px] border border-shelf bg-abyss/40 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-foam">{x.title}</span>
            <span className="block text-[11.5px] text-kelp">
              {x.status === "due" ? "Due" : x.status === "dismissed" ? "Dismissed" : x.at > now ? "Scheduled" : "Due"} · {dayYear(x.at)}{" "}
              {new Date(x.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            </span>
          </span>
          {x.status !== "dismissed" && (
            <button
              type="button"
              className="text-[11.5px] text-kelp hover:text-foam"
              onClick={() => live.dismissReminder(x.id).then(() => setHidden((h) => [...h, x.id]))}
            >
              Dismiss
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const SLOTS: [string, string][] = [
  ["attendance.minimum", "Minimum attendance"],
  ["library.hours", "Library hours"],
  ["pass.marks", "Pass mark"],
  ["hostel.curfew", "Hostel in-time"],
];

function Resolver() {
  const student = useStore((s) => s.student);
  const users = useStore((s) => s.world.users);
  const version = useStore((s) => s.world.memories.length + s.world.events.length);
  const now = useNow(60_000);
  const [slot, setSlot] = useState(SLOTS[0][0]);
  const [dept, setDept] = useState("");
  const [when, setWhen] = useState("");
  const [res, setRes] = useState<Resolved | null>(null);
  useEffect(() => {
    const asOf = when ? new Date(`${when}T12:00:00`).getTime() : undefined;
    live
      .resolve(slot, { user: student, scope: dept || undefined, asOf })
      .then(setRes)
      .catch(() => setRes(null));
  }, [slot, dept, when, student, version]);
  const depts = Array.from(new Set(["CSE", "ECE", "EEE", "MECH", ...(users ?? []).map((u) => u.department).filter(Boolean)])) as string[];
  const field = "h-8 rounded-[9px] border border-shelf bg-trench/70 px-2 text-[12.5px] text-foam outline-none focus-visible:border-kelp";
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Fact" className={field} value={slot} onChange={(e) => setSlot(e.target.value)}>
          {SLOTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Department" className={field} value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">The student’s department</option>
          {depts.map((d) => (
            <option key={d} value={d}>
              For {d}
            </option>
          ))}
        </select>
        <input aria-label="As of date" type="date" className={field} value={when} onChange={(e) => setWhen(e.target.value)} max={new Date(now + 365 * DAY).toISOString().slice(0, 10)} />
        {when && (
          <button type="button" className="text-[12px] text-kelp hover:text-foam" onClick={() => setWhen("")}>
            now
          </button>
        )}
      </div>
      {res && (
        <div className="mt-3">
          <p className="text-[20px] font-[620] text-foam">{res.value ?? "—"}</p>
          <p className="text-[12px] text-kelp">
            {res.source ? `from ${res.source.label}` : "nothing known"}
            {res.source?.appliesTo ? ` · ${res.source.appliesTo} only` : ""}
            {res.source ? ` · true since ${dayYear(res.source.validFrom)}` : ""}
          </p>
          {res.memories.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12px] text-kelp">
              {res.memories.map((m) => (
                <li key={m.id} className={cx(!m.visible && "opacity-50")}>
                  <span className="text-foam">{m.value}</span> · {m.status}
                  {m.appliesTo ? ` · ${m.appliesTo}` : ""} · {dayYear(m.validFrom)}
                  {m.validTo ? ` → ${dayYear(m.validTo)}` : " → now"}
                  {!m.visible ? " · another student's (private)" : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Staleness({ r }: { r: Research }) {
  const world = useStore((s) => s.world);
  const open = useStore((s) => s.openMemory);
  const title = (id: string) => {
    const c = world.chunks.find((x) => x.id === id);
    if (c) return `${c.title} (${c.docId} §${c.section})`;
    return world.memories.find((m) => m.id === id)?.text ?? id;
  };
  const top = r.staleness.filter((s) => s.staleness < 1).sort((a, b) => b.staleness - a.staleness).slice(0, 6);
  return (
    <ul className="space-y-2">
      {top.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => open(s.id)} className="w-full text-left">
            <p className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="truncate text-foam">{title(s.id)}</span>
              <span className="tnum shrink-0 text-kelp">{s.staleness.toFixed(2)}</span>
            </p>
            <Meter value={s.staleness} tone="#ff8a5c" className="mt-1" />
            <p className="mt-0.5 truncate text-[11px] text-kelp">{s.reasons.join(" · ")}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ page

export function ResearchView() {
  const hydrated = useHydrated();
  const { data, error, reload } = useResearch();
  const on = new Set(data?.novelties ?? []);
  const bench = (data?.benchmark ?? offline) as BenchmarkSummary;

  if (!hydrated) return <div className="min-h-[60vh]" aria-busy="true" />;

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Research</p>
          <h1 className="t-display-m mt-2 text-foam" style={{ ["--wdth" as string]: 108 }}>
            Beyond adaptive RAG
          </h1>
          <p className="mt-2 max-w-3xl text-[14.5px] text-kelp">
            Twelve extensions to the core system — each a small module in <code className="mono text-foam">backend/app/novelty</code>, switched with{" "}
            <code className="mono text-foam">NOVELTIES</code> — and a benchmark that measures what each one is responsible for.
          </p>
        </div>
        {LIVE && (
          <Button size="sm" variant="ghost" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </Button>
        )}
      </header>

      {!LIVE && (
        <div className="rounded-[12px] border border-sodium/40 bg-sodium/[0.06] px-4 py-3 text-[13.5px] text-foam">
          The extensions run in the FastAPI backend; this site is running the in-browser demo engine. Start the backend and set{" "}
          <code className="mono">NEXT_PUBLIC_API_URL</code> to try them live — the benchmark below was measured offline with{" "}
          <code className="mono">python -m bench.run</code>.
        </div>
      )}
      {LIVE && error && <div className="rounded-[12px] border border-flare/40 px-4 py-3 text-[13.5px] text-flare">Couldn’t load the research data: {error}</div>}

      <Panel title="Benchmark" meta={<span className="data">embedder: {bench.embedder}</span>} bodyClassName="p-4">
        <Benchmark b={bench} />
      </Panel>

      {data && (
        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          <Panel title="1 · Ask for a scope or a moment" bodyClassName="p-4">
            <Resolver />
          </Panel>
          <Panel title="2 · Ranking weights per question type" bodyClassName="p-4">
            <WeightsByType r={data} />
          </Panel>
          <Panel title="3 · Trust and verification" bodyClassName="p-4">
            <Trust r={data} />
          </Panel>
          <Panel title="5 · Forgetting rates" bodyClassName="p-4">
            <Forgetting r={data} />
          </Panel>
          <Panel title="10 · Stalest knowledge" bodyClassName="p-4">
            <Staleness r={data} />
          </Panel>
          <Panel title="11 · Reminders" bodyClassName="p-4">
            <Reminders r={data} />
          </Panel>
        </div>
      )}

      <Panel title="The twelve extensions" bodyClassName="p-4">
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {NOVELTIES.map((n) => {
            const switchable = data?.available.includes(n.key);
            const state = !data ? null : switchable ? (on.has(n.key) ? "on" : "off") : "always";
            return (
              <li key={n.n} className="rounded-[12px] border border-shelf bg-abyss/30 p-3.5">
                <p className="flex items-center gap-2">
                  <span className="data text-kelp">{String(n.n).padStart(2, "0")}</span>
                  <span className="text-[14px] font-[600] text-foam">{n.title}</span>
                  {state && (
                    <span
                      className={cx(
                        "ml-auto rounded-full border px-1.5 text-[10.5px]",
                        state === "off" ? "border-shelf text-kelp" : "border-glacier/45 text-glacier",
                      )}
                    >
                      {state === "always" ? "available" : state}
                    </span>
                  )}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-kelp">{n.body}</p>
                {n.where && (
                  <Link href={n.where.href} className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-foam underline decoration-shelf underline-offset-4 hover:decoration-kelp">
                    {n.where.label} <ArrowUpRight size={12} />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
