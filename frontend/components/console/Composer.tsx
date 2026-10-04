"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, FastForward } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import { Kbd } from "@/components/ui/Button";
import { DEMO_SCRIPT, type ScriptStep } from "@/lib/script";
import { HOUR, DAY } from "@/lib/engine/forget";
import { cx } from "@/lib/format";
import { spring } from "@/lib/motion";
import { useStore, type Stage } from "@/lib/store";

const STAGES: { key: Stage; label: string }[] = [
  { key: "classifying", label: "Classify" },
  { key: "remembering", label: "Remember" },
  { key: "retrieving", label: "Retrieve" },
  { key: "generating", label: "Answer" },
];

function Pipeline({ stage }: { stage: Stage }) {
  const at = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Pipeline progress">
      {STAGES.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className={cx(
              "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] transition-colors duration-300",
              i < at ? "text-kelp" : i === at ? "bg-sodium/12 text-foam" : "text-kelp/50",
            )}
          >
            <span className={cx("h-1.5 w-1.5 rounded-full", i < at ? "bg-kelp" : i === at ? "animate-breathe bg-sodium" : "bg-shelf")} />
            {s.label}
          </span>
          {i < STAGES.length - 1 && <span className="h-px w-3 bg-shelf" />}
        </li>
      ))}
    </ol>
  );
}

export function useRunStep() {
  const send = useStore((s) => s.send);
  const advanceTo = useStore((s) => s.advanceTo);
  const advance = useStore((s) => s.advance);
  const markStep = useStore((s) => s.markStep);
  return useCallback(
    async (step: ScriptStep) => {
      markStep(step.id);
      if (step.kind === "jump") {
        const st = useStore.getState();
        const exam = st.world.memories.find((m) => m.cls === "temporary" && m.status === "current" && m.expiresAt);
        if (exam?.expiresAt) advanceTo(exam.expiresAt + HOUR);
        else advance(DAY);
        return;
      }
      await send(step.text);
    },
    [send, advanceTo, advance, markStep],
  );
}

export function Composer({ extra }: { extra?: React.ReactNode }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = useStore((s) => s.send);
  const skip = useStore((s) => s.skip);
  const pending = useStore((s) => s.pending);
  const done = useStore((s) => s.world.scriptDone);
  const runStep = useRunStep();
  const next = DEMO_SCRIPT.find((s) => !done.includes(s.id));
  const chips = useRef<HTMLDivElement>(null);

  // keep the suggested next step in view in the scrolling chip row
  useEffect(() => {
    const el = chips.current?.querySelector<HTMLElement>(`[data-step="${next?.id}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [next?.id]);

  // auto-grow
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  // "/" focuses the composer; palette can run script steps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && t?.tagName !== "INPUT" && t?.tagName !== "TEXTAREA") {
        e.preventDefault();
        ref.current?.focus();
      }
      if (e.key === "Escape" && useStore.getState().pending) skip();
    };
    const onRun = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string; text: string }>).detail;
      const step = DEMO_SCRIPT.find((s) => s.id === id);
      if (step) runStep(step);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("script:run", onRun);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("script:run", onRun);
    };
  }, [runStep, skip]);

  const submit = () => {
    const v = text.trim();
    if (!v || pending) return;
    const step = DEMO_SCRIPT.find((s) => s.kind === "say" && s.text.toLowerCase() === v.toLowerCase());
    if (step) useStore.getState().markStep(step.id);
    setText("");
    send(v);
  };

  return (
    <div className="border-t hairline bg-abyss/70 px-4 pb-4 pt-3 backdrop-blur-md sm:px-6">
      {/* demo script */}
      <div className="mb-3 flex items-center gap-3">
        <p className="label hidden shrink-0 sm:block">Demo script</p>
        <div ref={chips} className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {DEMO_SCRIPT.map((s, i) => {
            const isDone = done.includes(s.id);
            const isNext = next?.id === s.id;
            return (
              <motion.button
                key={s.id}
                data-step={s.id}
                type="button"
                layout
                disabled={!!pending}
                onClick={() => runStep(s)}
                title={s.hint}
                className={cx(
                  "relative flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-[12.5px] transition-colors disabled:opacity-50",
                  isNext
                    ? "border-sodium/60 text-foam shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sodium)_14%,transparent)]"
                    : isDone
                      ? "border-shelf/60 text-kelp/80"
                      : "border-shelf text-kelp hover:border-kelp/60 hover:text-foam",
                )}
              >
                <span className="data text-[10.5px] text-kelp">{isDone ? <Glyph name="confirm" size={12} /> : i + 1}</span>
                {s.kind === "jump" && <Glyph name="temporary" size={12} />}
                <span className="max-w-[260px] truncate">{s.text}</span>
              </motion.button>
            );
          })}
        </div>
        {extra}
      </div>

      {/* composer */}
      <div
        className={cx(
          "relative rounded-[16px] border bg-trench/90 transition-[border-color,box-shadow] duration-200",
          pending ? "border-shelf" : "border-shelf focus-within:border-kelp/60 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-foam)_6%,transparent)]",
        )}
      >
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={next && next.kind === "say" ? `Ask a question, or tell it something worth remembering — try “${next.text}”` : "Ask a question, or tell it something worth remembering"}
          className="block max-h-[168px] min-h-[56px] w-full resize-none bg-transparent px-4 pb-11 pt-4 text-[15px] text-foam outline-none placeholder:text-kelp/70"
        />
        <div className="absolute inset-x-3 bottom-2.5 flex items-center justify-between gap-3">
          <AnimatePresence mode="wait" initial={false}>
            {pending ? (
              <motion.div key="p" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex min-w-0 items-center gap-2">
                <Pipeline stage={pending.stage} />
                <button type="button" onClick={skip} className="hidden items-center gap-1 text-[11.5px] text-kelp hover:text-foam sm:flex">
                  <FastForward size={12} /> Skip <Kbd>Esc</Kbd>
                </button>
              </motion.div>
            ) : (
              <motion.p key="h" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hidden items-center gap-1.5 text-[11.5px] text-kelp/80 sm:flex">
                <Kbd>Enter</Kbd> send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line · <Kbd>/</Kbd> focus
              </motion.p>
            )}
          </AnimatePresence>
          <motion.button
            type="button"
            onClick={submit}
            disabled={!text.trim() || !!pending}
            whileTap={{ scale: 0.92 }}
            transition={spring.snap}
            aria-label="Send"
            className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foam text-abyss transition-[opacity,background-color] hover:bg-white disabled:opacity-30"
          >
            <ArrowUp size={18} strokeWidth={2.2} />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
