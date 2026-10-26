"use client";

import { motion } from "motion/react";
import type { Citation, Span, Turn } from "@/lib/engine/types";
import { MorphText } from "@/components/ui/motion-bits";
import { ClassifierStrip } from "./ClassifierStrip";
import { FeedbackBar } from "./FeedbackBar";
import { AnswerInsights } from "./AnswerInsights";
import { clock, cx } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { useStore, type Stage } from "@/lib/store";
import { useReducedMotion } from "@/lib/reduced-motion";

const SPAN_STYLE: Record<Span["kind"], string> = {
  value: "decoration-sodium",
  topic: "decoration-glacier",
  time: "decoration-rhodamine decoration-dashed",
  cue: "decoration-foam/60 decoration-dotted",
  entity: "decoration-rhodamine",
};
const SPAN_TITLE: Record<Span["kind"], string> = {
  value: "Value",
  topic: "Topic",
  time: "Time-bound",
  cue: "Cue phrase",
  entity: "Name",
};

function Highlighted({ text, spans }: { text: string; spans?: Span[] }) {
  if (!spans?.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    if (s.start > at) out.push(text.slice(at, s.start));
    out.push(
      <span
        key={i}
        title={SPAN_TITLE[s.kind]}
        style={{ animationDelay: `${i * 90}ms` }}
        className={cx("underline-in underline decoration-[1.5px] underline-offset-[5px]", SPAN_STYLE[s.kind])}
      >
        {text.slice(s.start, s.end)}
      </span>,
    );
    at = s.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

function Gutter({ who, at, tone }: { who: string; at: number; tone: string }) {
  return (
    <div className="pt-[3px]">
      <p className={cx("label", tone)}>{who}</p>
      <p className="data mt-1 text-[10.5px] text-kelp/70">{clock(at)}</p>
    </div>
  );
}

export function UserTurn({ turn }: { turn: Turn }) {
  const reduced = useReducedMotion();
  const c = turn.classification;
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.fluid}
      className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-4"
    >
      <Gutter who="You" at={turn.at} tone="text-foam" />
      <div className="min-w-0">
        <p className="relative inline-block max-w-full text-[16px] leading-relaxed text-foam">
          <MorphText settled={!!c}>
            <Highlighted text={turn.text} spans={c?.spans} />
          </MorphText>
          {!c && !reduced && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-y-[-3px] w-16 bg-gradient-to-r from-transparent via-sodium/35 to-transparent"
              initial={{ left: "-15%" }}
              animate={{ left: "105%" }}
              transition={{ duration: 0.75, ease: ease.inOut, repeat: Infinity, repeatDelay: 0.15 }}
            />
          )}
        </p>
        {!c && <p className="label mt-2 animate-breathe text-sodium">Reading your message…</p>}
        {c && <ClassifierStrip c={c} ops={turn.memoryOps} />}
      </div>
    </motion.article>
  );
}

function Cite({ n, itemId, kind }: { n: number; itemId: string; kind: "document" | "memory" }) {
  const hover = useStore((s) => s.hover);
  const open = useStore((s) => s.openMemory);
  const active = useStore((s) => s.hoverId === itemId);
  return (
    <motion.button
      type="button"
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={spring.snap}
      onPointerEnter={() => hover(itemId)}
      onPointerLeave={() => hover(null)}
      onFocus={() => hover(itemId)}
      onBlur={() => hover(null)}
      onClick={() => open(itemId)}
      aria-label={`Source ${n}`}
      className={cx(
        "data relative mx-[2px] inline-flex h-[18px] min-w-[18px] -translate-y-[1px] items-center justify-center gap-1 rounded-[5px] border px-1 align-middle text-[10.5px] leading-none text-foam transition-colors",
        kind === "memory" ? "border-rhodamine/45" : "border-glacier/45",
        active ? (kind === "memory" ? "bg-rhodamine/20" : "bg-glacier/20") : "bg-abyss/50 hover:bg-reef",
      )}
    >
      {n}
    </motion.button>
  );
}

function AnswerText({ text, citations, kindOf }: { text: string; citations: Citation[]; kindOf: (id: string) => "document" | "memory" }) {
  const lines = text.split("\n");
  const inline = (s: string) =>
    s.split(/(\[\d+\])/).map((part, i) => {
      const m = part.match(/^\[(\d+)\]$/);
      if (!m) return <span key={i}>{part}</span>;
      const n = Number(m[1]);
      const c = citations.find((x) => x.n === n);
      return c ? <Cite key={i} n={n} itemId={c.itemId} kind={kindOf(c.itemId)} /> : null;
    });
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const m = line.match(/^(\d+)\.\s+(.*)$/);
        return m ? (
          <p key={i} className="grid grid-cols-[1.4em_minmax(0,1fr)] gap-1">
            <span className="data pt-[3px] text-kelp">{m[1]}.</span>
            <span>{inline(m[2])}</span>
          </p>
        ) : (
          <p key={i}>{inline(line)}</p>
        );
      })}
    </div>
  );
}

const STAGE_TEXT: Record<Stage, string> = {
  classifying: "Reading your message…",
  remembering: "Updating memory…",
  retrieving: "Searching the knowledge base and memory…",
  generating: "Writing…",
};

export function AssistantTurn({ turn, selected }: { turn: Turn; selected: boolean }) {
  const stream = useStore((s) => (s.stream?.turnId === turn.id ? s.stream.chars : null));
  const stage = useStore((s) => (s.pending?.assistantId === turn.id ? s.pending.stage : null));
  const select = useStore((s) => s.selectTurn);
  const world = useStore((s) => s.world);
  const kindOf = (id: string) => (world.memories.some((m) => m.id === id) ? "memory" : "document") as "document" | "memory";
  const text = turn.status === "retrieving" ? "" : stream !== null ? turn.text.slice(0, stream) : turn.text;
  const streaming = turn.status === "streaming";
  const r = turn.retrieval;

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.fluid}
      className="group grid grid-cols-[52px_minmax(0,1fr)] gap-3 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-4"
    >
      <Gutter who="RAG" at={turn.at} tone="text-rhodamine" />
      <div
        className={cx(
          "relative min-w-0 rounded-[14px] border px-4 py-3 transition-colors",
          selected ? "border-shelf bg-trench/60" : "border-transparent hover:border-shelf/60",
        )}
        onClick={() => turn.status === "done" && select(turn.id)}
      >
        {turn.status === "retrieving" && (
          <div className="flex items-center gap-2 text-[13px] text-kelp">
            <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-sodium" />
            {stage ? STAGE_TEXT[stage] : "Searching…"}
            {r && (
              <span className="data text-kelp/80">
                {r.searched.chunks} passages · {r.searched.memories} memories
              </span>
            )}
          </div>
        )}
        {turn.status === "error" ? (
          <p className="text-[14px] text-flare">
            {turn.error ?? "Something went wrong."} Start the FastAPI server, or remove NEXT_PUBLIC_API_URL to use the demo engine.
          </p>
        ) : (
          text && (
            <div className={cx("text-[15.5px] leading-relaxed text-foam", streaming && "is-streaming")}>
              <AnswerText text={text} citations={turn.citations ?? []} kindOf={kindOf} />
            </div>
          )
        )}
        {turn.status === "done" && r && r.preferences.length > 0 && turn.intent && !turn.intent.startsWith("ack") && (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-kelp/80">
            <span className="h-1 w-1 rounded-full bg-rhodamine" />
            Shaped by your preference: {r.preferences.map((p) => p.text.replace(/^Prefers /, "").toLowerCase()).join(", ")}
          </p>
        )}
        {turn.status === "done" && <AnswerInsights turn={turn} />}
        {turn.status === "done" && !turn.intent?.startsWith("ack") && turn.intent !== "greeting" && turn.intent !== "thanks" && (
          <FeedbackBar turn={turn} />
        )}
      </div>
    </motion.article>
  );
}
