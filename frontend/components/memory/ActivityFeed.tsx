"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { ActivityEvent } from "@/lib/engine/types";
import { Glyph } from "@/components/ui/Glyph";
import { EVENT_GLYPH } from "@/lib/events";
import { cx, relTime } from "@/lib/format";
import { spring } from "@/lib/motion";
import { useStore } from "@/lib/store";

export function ActivityFeed({ events, now, limit = 40 }: { events: ActivityEvent[]; now: number; limit?: number }) {
  const open = useStore((s) => s.openMemory);
  const memories = useStore((s) => s.world.memories);
  const [showWeights, setShowWeights] = useState(false);
  const list = events.filter((e) => showWeights || e.type !== "weights.updated").slice(0, limit);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-1">
        <p className="text-[12px] text-kelp">{list.length} most recent</p>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-kelp">
          <input type="checkbox" checked={showWeights} onChange={(e) => setShowWeights(e.target.checked)} className="accent-[var(--color-sodium)]" />
          Include ranking updates
        </label>
      </div>
      <ol className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <span aria-hidden className="absolute bottom-4 left-[29px] top-1 w-px bg-shelf/70" />
        <AnimatePresence initial={false}>
          {list.map((e) => {
            const g = EVENT_GLYPH[e.type];
            const clickable = !!e.refId && memories.some((m) => m.id === e.refId);
            return (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, x: -8, backgroundColor: "color-mix(in oklab, var(--color-sodium) 14%, transparent)" }}
                animate={{ opacity: 1, x: 0, backgroundColor: "rgba(0,0,0,0)" }}
                exit={{ opacity: 0 }}
                transition={{ ...spring.fluid, backgroundColor: { duration: 1.6 } }}
                className="relative rounded-[10px]"
              >
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => e.refId && open(e.refId)}
                  className={cx("flex w-full gap-3 rounded-[10px] px-1.5 py-2 text-left", clickable && "hover:bg-reef/60")}
                >
                  <span className={cx("relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-shelf bg-abyss", g.tone)}>
                    <Glyph name={g.glyph} size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-[600] text-foam">{e.title}</span>
                      <span className="data shrink-0 text-[10.5px] text-kelp">{relTime(e.at, now)}</span>
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-kelp">{e.detail}</span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );
}
