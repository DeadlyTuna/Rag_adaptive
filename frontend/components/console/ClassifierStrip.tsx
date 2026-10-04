"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Classification, MemoryOp } from "@/lib/engine/types";
import { CLASSES } from "@/lib/engine/types";
import { Glyph, CLASS_LABEL, type GlyphName } from "@/components/ui/Glyph";
import { cx } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { useStore } from "@/lib/store";
import { useReducedMotion } from "@/lib/reduced-motion";

const WIN_TONE: Record<string, string> = {
  correction: "var(--color-sodium)",
  irrelevant: "var(--color-kelp)",
  persistent: "var(--color-rhodamine)",
  important: "var(--color-rhodamine)",
  temporary: "var(--color-rhodamine)",
};

const DECISION: Record<Classification["decision"], { text: string; glyph: GlyphName; tone: string }> = {
  store: { text: "Stored", glyph: "added", tone: "text-rhodamine" },
  replace: { text: "Replaced an older fact", glyph: "correction", tone: "text-sodium" },
  reinforce: { text: "Reinforced", glyph: "confirm", tone: "text-rhodamine" },
  "keep-temporarily": { text: "Kept for now", glyph: "temporary", tone: "text-rhodamine" },
  discard: { text: "Not stored", glyph: "irrelevant", tone: "text-kelp" },
  "flag-previous": { text: "Flagged the previous answer", glyph: "flag", tone: "text-flare" },
  question: { text: "Question · not stored", glyph: "irrelevant", tone: "text-kelp" },
};

export function ProbabilityBars({ c }: { c: Classification }) {
  const reduced = useReducedMotion();
  const order = [...CLASSES].sort((a, b) => c.probs[b] - c.probs[a]);
  return (
    <ul className="space-y-1.5" aria-label="Class probabilities">
      {order.map((cls, i) => {
        const p = c.probs[cls];
        const win = cls === c.label;
        return (
          <li key={cls} className="grid grid-cols-[86px_1fr_40px] items-center gap-3">
            <span className={cx("text-[12px]", win ? "font-[600] text-foam" : "text-kelp")}>{CLASS_LABEL[cls]}</span>
            <span className="relative h-[7px] overflow-hidden rounded-r-[4px] rounded-l-[2px] bg-shelf/35">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-r-[4px] rounded-l-[2px]"
                style={{ background: win ? WIN_TONE[cls] : "var(--color-shelf)" }}
                initial={reduced ? false : { width: 0 }}
                animate={{ width: `${Math.max(p * 100, 0.8)}%` }}
                transition={{ delay: i * 0.08, duration: 0.6, ease: ease.out }}
              />
            </span>
            <span className={cx("data text-right", win ? "text-foam" : "text-kelp")}>{p.toFixed(2)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function OpChip({ op, delay = 0 }: { op: MemoryOp; delay?: number }) {
  const open = useStore((s) => s.openMemory);
  const glyph: GlyphName =
    op.kind === "replace" ? "correction" : op.kind === "flag" ? "flag" : op.kind === "reinforce" ? "confirm" : op.kind === "discard" ? "irrelevant" : op.kind === "expire" ? "expired" : "added";
  const tone = op.kind === "replace" ? "text-sodium" : op.kind === "flag" ? "text-flare" : op.kind === "discard" ? "text-kelp" : "text-rhodamine";
  const target = op.memoryId ?? op.previousId;
  return (
    <motion.button
      type="button"
      disabled={!target}
      onClick={() => target && open(target)}
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring.snap, delay }}
      className="group relative flex w-full items-start gap-2.5 overflow-hidden rounded-[10px] border border-shelf bg-abyss/50 px-3 py-2 text-left transition-colors enabled:hover:border-kelp/50 disabled:cursor-default"
    >
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-[10px]"
        initial={{ boxShadow: `inset 0 0 0 1px ${op.kind === "replace" ? "var(--color-sodium)" : "var(--color-rhodamine)"}`, opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ delay: delay + 0.4, duration: 1.4 }}
      />
      <Glyph name={glyph} className={cx("mt-0.5 shrink-0", tone)} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-[560] text-foam">{op.title}</span>
        {op.detail && <span className="block text-[12px] text-kelp">{op.detail}</span>}
      </span>
      {target && <span className="label self-center opacity-0 transition-opacity group-hover:opacity-100">Open</span>}
    </motion.button>
  );
}

export function ClassifierStrip({ c, ops }: { c: Classification; ops?: MemoryOp[] }) {
  const [open, setOpen] = useState(false);
  const d = DECISION[c.decision];

  if (c.decision === "question") {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-full border border-shelf/70 px-2.5 py-1 text-[12px] text-kelp transition-colors hover:border-kelp/50 hover:text-foam"
        >
          <Glyph name="irrelevant" size={13} />
          Question · not stored
          {c.slotLabel && <span className="text-kelp/80">· about {c.slotLabel.toLowerCase()}</span>}
          <ChevronDown size={13} className={cx("transition-transform", open && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: ease.out }}
              className="overflow-hidden"
            >
              <div className="mt-2 max-w-[520px] rounded-[12px] border border-shelf bg-trench/70 p-3">
                <ProbabilityBars c={c} />
                <p className="mt-2.5 text-[12.5px] text-kelp">{c.reason}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={{ duration: 0.45, ease: ease.out }}
      className="overflow-hidden"
    >
      <div className="mt-3 max-w-[560px] rounded-[14px] border border-shelf bg-trench/75 p-3.5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="label">Memory classifier</p>
          <p className={cx("flex items-center gap-1.5 text-[12px] font-[560]", d.tone)}>
            <Glyph name={d.glyph} size={13} />
            <span className="text-foam">{d.text}</span>
          </p>
        </div>
        <ProbabilityBars c={c} />
        <div className="mt-3 space-y-1.5 border-t hairline pt-3 text-[12.5px] text-kelp">
          {c.coref && (
            <p className="flex gap-2">
              <span className="data text-kelp/80">↳</span>
              <span>Resolved {c.coref}</span>
            </p>
          )}
          {c.conflict ? (
            <p className="flex gap-2">
              <Glyph name="correction" size={13} className="mt-0.5 shrink-0 text-sodium" />
              <span>
                Conflicts with <span className="text-foam">“{c.conflict.withText}”</span> from {c.conflict.withSource}
              </span>
            </p>
          ) : (
            c.decision !== "discard" && (
              <p className="flex gap-2">
                <Glyph name="confirm" size={13} className="mt-0.5 shrink-0" />
                <span>{c.decision === "reinforce" ? "Matches what it already knew." : "No conflict with anything it knows."}</span>
              </p>
            )
          )}
          <p className="flex gap-2">
            <span className="data text-kelp/80">→</span>
            <span>{c.reason}</span>
          </p>
        </div>
        {ops && ops.length > 0 && ops[0].kind !== "discard" && (
          <div className="mt-3 space-y-1.5">
            {ops.map((op, i) => (
              <OpChip key={i} op={op} delay={0.15 + i * 0.1} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
