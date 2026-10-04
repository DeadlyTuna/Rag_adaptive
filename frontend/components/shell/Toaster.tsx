"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { X } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import { EVENT_GLYPH } from "@/lib/events";
import { spring } from "@/lib/motion";
import { useStore, type Toast } from "@/lib/store";

function ToastCard({ t }: { t: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  const open = useStore((s) => s.openMemory);
  const isMemory = useStore((s) => !!t.refId && s.world.memories.some((m) => m.id === t.refId));
  const g = EVENT_GLYPH[t.type];
  useEffect(() => {
    const id = setTimeout(() => dismiss(t.id), 6000);
    return () => clearTimeout(id);
  }, [t.id, dismiss]);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
      transition={spring.fluid}
      className="pointer-events-auto relative flex w-[340px] max-w-[calc(100vw-32px)] items-start gap-3 overflow-hidden rounded-[14px] border border-shelf bg-trench/95 p-3 pr-9 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.7)] backdrop-blur"
    >
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-shelf bg-abyss ${g.tone}`}>
        <Glyph name={g.glyph} />
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 text-left disabled:cursor-default"
        disabled={!isMemory}
        onClick={() => {
          if (t.refId) open(t.refId);
          dismiss(t.id);
        }}
      >
        <p className="text-[13px] font-[600] text-foam">{t.title}</p>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-kelp">{t.detail}</p>
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(t.id)}
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-kelp hover:bg-reef hover:text-foam"
      >
        <X size={14} />
      </button>
      <motion.span
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-shelf"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: 6, ease: "linear" }}
      />
    </motion.li>
  );
}

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  return (
    <ol aria-label="Memory notifications" className="pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2 md:bottom-5 md:right-5">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
