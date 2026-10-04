"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanelRight, X } from "lucide-react";
import { AssistantTurn, UserTurn } from "./Turns";
import { Composer, useRunStep } from "./Composer";
import { Inspector } from "./Inspector";
import { Glyph } from "@/components/ui/Glyph";
import { DEMO_SCRIPT } from "@/lib/script";
import { spring } from "@/lib/motion";
import { useHydrated, useStore } from "@/lib/store";

function Intro() {
  const runStep = useRunStep();
  const first = DEMO_SCRIPT[0];
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mx-auto max-w-[620px] py-10">
      <p className="label">Console</p>
      <h1 className="t-display-m mt-3 text-foam" style={{ ["--wdth" as string]: 104 }}>
        Ask it something. Then correct it.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-kelp">
        Every message is classified before it’s answered: some things are remembered, some replace what it believed, most are let go. Each answer
        shows which passages and memories it used, and how each one scored — the inspector updates as it happens.
      </p>
      <ul className="mt-6 grid gap-2 text-[13.5px] text-kelp sm:grid-cols-3">
        {[
          { g: "added" as const, t: "Facts and preferences you share are remembered" },
          { g: "correction" as const, t: "Corrections replace the old fact — it’s kept as history" },
          { g: "weights" as const, t: "Feedback re-weights how sources are ranked" },
        ].map((x) => (
          <li key={x.t} className="flex gap-2.5 rounded-[12px] border border-shelf bg-trench/60 p-3">
            <Glyph name={x.g} className={x.g === "correction" ? "mt-0.5 shrink-0 text-sodium" : "mt-0.5 shrink-0 text-rhodamine"} />
            {x.t}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => runStep(first)}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-foam px-5 text-[14px] font-[600] text-abyss transition-colors hover:bg-white"
      >
        Start the guided demo
        <span className="mono hidden text-[12px] font-[500] text-abyss/70 sm:inline">“{first.text}”</span>
      </button>
    </motion.div>
  );
}

function Transcript() {
  const turns = useStore((s) => s.world.turns);
  const selectedId = useStore((s) => s.selectedTurnId);
  const streamChars = useStore((s) => s.stream?.chars ?? 0);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seen = useRef(turns.length);
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
  const selected = selectedId ?? lastAssistant?.id;
  const empty = turns.length === 0;

  // only the reader's own scrolling can unpin the view (not our programmatic scrolls)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () =>
      requestAnimationFrame(() => {
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
      });
    el.addEventListener("wheel", check, { passive: true });
    el.addEventListener("touchmove", check, { passive: true });
    el.addEventListener("keydown", check);
    // content grows without React renders (height animations) — keep pinned
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    if (content.current) ro.observe(content.current);
    return () => {
      el.removeEventListener("wheel", check);
      el.removeEventListener("touchmove", check);
      el.removeEventListener("keydown", check);
      ro.disconnect();
    };
  }, [empty]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (turns.length > seen.current) stick.current = true; // a new message: follow it
    seen.current = turns.length;
    if (stick.current && turns.length > 0) el.scrollTop = el.scrollHeight;
  }, [turns, streamChars]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
      {turns.length === 0 ? (
        <Intro />
      ) : (
        <div ref={content} className="mx-auto max-w-[760px] space-y-7 py-8">
          {turns.map((t) =>
            t.role === "user" ? <UserTurn key={t.id} turn={t} /> : <AssistantTurn key={t.id} turn={t} selected={t.id === selected} />,
          )}
        </div>
      )}
    </div>
  );
}

export function Console() {
  const hydrated = useHydrated();
  const [sheet, setSheet] = useState(false);

  if (!hydrated) {
    return <div className="h-[calc(100dvh-56px-64px)] md:h-[calc(100dvh-56px)]" aria-busy="true" />;
  }

  return (
    <div className="grid h-[calc(100dvh-56px-64px)] grid-cols-1 md:h-[calc(100dvh-56px)] xl:grid-cols-[minmax(0,1fr)_minmax(400px,30vw)]">
      <section className="relative flex min-h-0 flex-col" aria-label="Conversation">
        <Transcript />
        <Composer
          extra={
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-shelf bg-trench/90 px-3 text-[12px] text-kelp hover:text-foam xl:hidden"
            >
              <PanelRight size={14} /> Inspector
            </button>
          }
        />
      </section>

      <Inspector className="hidden border-l hairline bg-abyss/30 xl:flex" />

      <Dialog.Root open={sheet} onOpenChange={setSheet}>
        <AnimatePresence>
          {sheet && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-[55] bg-abyss/60 xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="fixed inset-y-0 right-0 z-[56] flex w-[min(460px,100vw)] flex-col border-l border-shelf bg-trench xl:hidden"
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={spring.fluid}
                >
                  <Dialog.Title className="sr-only">Inspector</Dialog.Title>
                  <Dialog.Close asChild>
                    <button type="button" aria-label="Close inspector" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-kelp hover:bg-reef hover:text-foam">
                      <X size={16} />
                    </button>
                  </Dialog.Close>
                  <Inspector className="flex min-h-0 flex-1" />
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </div>
  );
}
