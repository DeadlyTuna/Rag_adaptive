"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { Feedback, Turn } from "@/lib/engine/types";
import { FACTORS } from "@/lib/engine/types";
import { Glyph } from "@/components/ui/Glyph";
import { FACTOR_META } from "@/lib/factors";
import { cx, signed } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { useStore } from "@/lib/store";

const REASONS: { value: NonNullable<Feedback["reason"]>; label: string; hint: string }[] = [
  { value: "wrong_source", label: "Wrong source", hint: "It used a passage or memory that doesn't answer this" },
  { value: "outdated", label: "Outdated", hint: "A source it used is no longer true" },
  { value: "incomplete", label: "Incomplete", hint: "Right sources, but something is missing" },
];

function Result({ fb, turn }: { fb: Feedback; turn: Turn }) {
  const title = (id?: string) => turn.retrieval?.candidates.find((c) => c.id === id)?.title ?? "the source";
  const moved = fb.deltas ? FACTORS.filter((f) => Math.abs(fb.deltas![f]) >= 0.001) : [];
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-kelp">
      <span className="flex items-center gap-1.5">
        <Glyph name={fb.verdict === "helpful" ? "confirm" : "flag"} size={13} className={fb.verdict === "helpful" ? "text-rhodamine" : "text-flare"} />
        {fb.verdict === "helpful"
          ? "Thanks — the sources it cited are trusted a little more."
          : fb.reason === "incomplete"
            ? "Noted as incomplete."
            : `Lowered trust in ${title(fb.targetId)}${fb.reliability ? ` (${fb.reliability.from.toFixed(2)} → ${fb.reliability.to.toFixed(2)})` : ""}.`}
      </span>
      {moved.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>Weights:</span>
          {moved.map((f, i) => (
            <motion.span
              key={f}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.snap, delay: 0.1 + i * 0.07 }}
              className="data inline-flex items-center gap-1 rounded-full border border-shelf px-1.5 py-0.5 text-foam"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: FACTOR_META[f].color }} />
              {f} {signed(fb.deltas![f], 3)}
            </motion.span>
          ))}
        </span>
      )}
    </motion.div>
  );
}

export function FeedbackBar({ turn }: { turn: Turn }) {
  const send = useStore((s) => s.feedback);
  const busy = useStore((s) => !!s.pending);
  const [step, setStep] = useState<"idle" | "reason" | "source">("idle");
  const [reason, setReason] = useState<Feedback["reason"]>();
  const fb = turn.feedback;
  const sources = turn.retrieval?.candidates ?? [];

  if (fb) return <div className="mt-3">{<Result fb={fb} turn={turn} />}</div>;
  if (!sources.length) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.3 }} className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-kelp">{busy ? "Feedback opens when the current answer finishes." : "Was this helpful?"}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => send(turn.id, "helpful")}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-shelf px-2.5 text-[12px] text-kelp transition-colors hover:border-kelp/60 hover:text-foam disabled:opacity-40"
        >
          <ThumbsUp size={13} strokeWidth={1.8} /> Helpful
        </button>
        <button
          type="button"
          aria-expanded={step !== "idle"}
          disabled={busy}
          onClick={() => setStep(step === "idle" ? "reason" : "idle")}
          className={cx(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors disabled:opacity-40",
            step !== "idle" ? "border-flare/50 text-foam" : "border-shelf text-kelp hover:border-kelp/60 hover:text-foam",
          )}
        >
          <ThumbsDown size={13} strokeWidth={1.8} /> Not helpful
        </button>
      </div>
      <AnimatePresence initial={false}>
        {step !== "idle" && !busy && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: ease.out }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 max-w-[560px] rounded-[12px] border border-shelf bg-trench/70 p-3">
              {step === "reason" && (
                <>
                  <p className="mb-2 text-[12.5px] text-kelp">What went wrong?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {REASONS.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        title={r.hint}
                        onClick={() => {
                          setReason(r.value);
                          if (r.value === "incomplete") send(turn.id, "not_helpful", "incomplete");
                          else setStep("source");
                        }}
                        className="h-8 rounded-[8px] border border-shelf px-3 text-[12.5px] text-foam transition-colors hover:border-kelp/60 hover:bg-reef"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {step === "source" && (
                <>
                  <p className="mb-2 text-[12.5px] text-kelp">
                    {reason === "outdated" ? "Which source is out of date?" : "Which source was wrong for this question?"}
                  </p>
                  <ul className="space-y-1">
                    {sources.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => send(turn.id, "not_helpful", reason, c.id)}
                          onPointerEnter={() => useStore.getState().hover(c.id)}
                          onPointerLeave={() => useStore.getState().hover(null)}
                          className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] text-foam transition-colors hover:bg-reef"
                        >
                          <span className="data w-4 text-kelp">{c.rank}</span>
                          <Glyph name={c.kind === "document" ? "document" : "memory"} size={13} className={c.kind === "document" ? "text-glacier" : "text-rhodamine"} />
                          <span className="min-w-0 flex-1 truncate">{c.title}</span>
                          <span className="truncate text-kelp">{c.subtitle}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
