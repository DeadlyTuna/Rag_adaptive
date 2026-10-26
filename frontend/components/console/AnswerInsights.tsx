"use client";

// What the backend's research extensions say about an answer: how sure it was (and
// whether it asked or declined instead), which scope / moment it answered for, which
// question type's learned weights ranked the sources — and, on request, what the same
// question gets without the learning (GET /api/turns/{id}/counterfactual).

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { FlaskConical, History, Scale } from "lucide-react";
import type { Turn } from "@/lib/engine/types";
import { LIVE, live, type Counterfactual } from "@/lib/api/live";
import { cx } from "@/lib/format";
import { spring } from "@/lib/motion";

const GROUP_LABEL: Record<string, string> = {
  rule: "rule questions",
  time: "time & date questions",
  personal: "questions about you",
  general: "general questions",
};

function Chip({ tone, title, children }: { tone: string; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px]", tone)}>
      {children}
    </span>
  );
}

function confidenceTone(mode: string, c: number) {
  if (mode === "abstain") return "border-shelf text-kelp";
  if (mode === "clarify" || c < 0.5) return "border-sodium/50 text-sodium";
  return c >= 0.75 ? "border-glacier/45 text-glacier" : "border-shelf text-foam";
}

const stripCites = (t: string) => t.replace(/\s*\[\d+\]/g, "");

function CounterfactualPanel({ turnId }: { turnId: string }) {
  const [data, setData] = useState<Counterfactual | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    live
      .counterfactual(turnId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [turnId]);

  if (error) return <p className="mt-3 text-[12.5px] text-flare">Couldn’t compute it: {error}</p>;
  if (!data) return <p className="mt-3 animate-breathe text-[12.5px] text-kelp">Re-answering without the learning…</p>;
  const order = ["no_memory", "no_feedback", "plain"] as const;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[12px] text-kelp">
        The same question, re-answered by the template generator on copies of the knowledge with parts of the learning removed:
      </p>
      {order.map((k) => {
        const v = data.variants[k];
        return (
          <div key={k} className="rounded-[10px] border border-shelf bg-abyss/50 px-3 py-2.5">
            <p className="flex items-center gap-2 text-[12px]">
              <span className="font-[600] text-foam">{v.label}</span>
              <span className={cx("ml-auto rounded-full border px-1.5 text-[10.5px]", v.sameAsAdaptive ? "border-shelf text-kelp" : "border-sodium/50 text-sodium")}>
                {v.sameAsAdaptive ? "same answer" : "different answer"}
              </span>
            </p>
            {!v.sameAsAdaptive && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-foam/85">{stripCites(v.text)}</p>}
            {!v.sameAsAdaptive && v.citations.length > 0 && (
              <p className="mt-1 text-[11.5px] text-kelp">Sources: {v.citations.map((c) => c.title).join(" · ")}</p>
            )}
          </div>
        );
      })}
      {data.memoriesUsed.length > 0 && (
        <p className="text-[12px] text-kelp">
          Learned memories behind today’s answer: <span className="text-foam">{data.memoriesUsed.map((m) => m.title).join(" · ")}</span>
        </p>
      )}
    </div>
  );
}

export function AnswerInsights({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false);
  const a = turn.answerability;
  const ctx = turn.context;
  const r = turn.retrieval;
  const share = r?.groupShare ?? 0;
  if (!a && !ctx?.label && !(r?.intentGroup && share > 0)) return null;
  const canCompare = LIVE && a && a.mode === "answer" && turn.intent !== "arithmetic";

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {ctx?.label && (
          <Chip tone="border-sodium/45 text-sodium" title="Answered for a different moment or department than now / yours">
            <History size={12} /> {ctx.label}
          </Chip>
        )}
        {a && (
          <Chip tone={confidenceTone(a.mode, a.confidence)} title={a.reasons.join("\n")}>
            {a.mode === "clarify" ? "Asked instead of guessing" : a.mode === "abstain" ? "Declined to guess" : "Confidence"}
            <span className="tnum">{a.confidence.toFixed(2)}</span>
          </Chip>
        )}
        {r?.intentGroup && share > 0 && (
          <Chip tone="border-shelf text-kelp" title="Ranking weights learned from feedback on this type of question, blended with the global weights">
            <Scale size={12} /> Ranked for {GROUP_LABEL[r.intentGroup] ?? r.intentGroup} · {Math.round(share * 100)}% type-specific
          </Chip>
        )}
        {canCompare && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-full border border-shelf px-2 py-0.5 text-[11.5px] text-kelp transition-colors hover:border-kelp/60 hover:text-foam"
          >
            <FlaskConical size={12} /> {open ? "Hide the comparison" : "What if it hadn’t learned?"}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.fluid} className="overflow-hidden">
            <CounterfactualPanel turnId={turn.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
