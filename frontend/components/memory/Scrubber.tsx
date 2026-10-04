"use client";

// "As of" — the page's time filter. Drag to rewind memory; play to watch it evolve.

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { ActivityEvent } from "@/lib/engine/types";
import { DAY } from "@/lib/engine/forget";
import { EVENT_GLYPH } from "@/lib/events";
import { cx, day, relTime } from "@/lib/format";
import { useWidth } from "@/lib/hooks";
import { spring } from "@/lib/motion";

const TICK_COLOR: Record<string, string> = {
  "text-rhodamine": "var(--color-rhodamine)",
  "text-sodium": "var(--color-sodium)",
  "text-glacier": "var(--color-glacier)",
  "text-kelp": "var(--color-kelp)",
  "text-foam": "var(--color-foam)",
  "text-flare": "var(--color-flare)",
};

export function Scrubber({
  start,
  now,
  value,
  onChange,
  events,
}: {
  start: number;
  now: number;
  value: number | null; // null = live
  onChange: (t: number | null) => void;
  events: ActivityEvent[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>(800);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const t = value ?? now;
  const span = Math.max(now - start, DAY);
  const pos = ((t - start) / span) * width;

  const toTime = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const v = start + f * span;
    return f > 0.995 ? null : v;
  };

  // play: sweep from the start of the record to now in ~9s
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let cur = value ?? start;
    if (value === null) cur = start;
    const step = (ts: number) => {
      const dt = ts - last;
      last = ts;
      cur += (span / 9000) * dt;
      if (cur >= now) {
        onChange(null);
        setPlaying(false);
        return;
      }
      onChange(cur);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const ticks = events.filter((e) => e.at >= start && e.at <= now && e.type !== "weights.updated");

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause replay" : "Replay how memory evolved"}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-shelf bg-trench text-foam transition-colors hover:border-kelp/60 hover:bg-reef"
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="translate-x-[1px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          ref={ref}
          role="slider"
          tabIndex={0}
          aria-label="Show memory as of"
          aria-valuemin={start}
          aria-valuemax={now}
          aria-valuenow={Math.round(t)}
          aria-valuetext={value === null ? "Now" : `${day(t)}, ${relTime(t, now)}`}
          className="relative h-12 cursor-pointer touch-none select-none outline-none"
          onPointerDown={(e) => {
            setDragging(true);
            setPlaying(false);
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            onChange(toTime(e.clientX));
          }}
          onPointerMove={(e) => dragging && onChange(toTime(e.clientX))}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={(e) => {
            const stepMs = e.shiftKey ? 7 * DAY : DAY;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(start, t - stepMs));
            else if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(t + stepMs >= now ? null : t + stepMs);
            else if (e.key === "Home") onChange(start);
            else if (e.key === "End") onChange(null);
            else return;
            e.preventDefault();
          }}
        >
          {/* event ticks */}
          {ticks.map((e) => {
            const g = EVENT_GLYPH[e.type];
            const x = ((e.at - start) / span) * width;
            return (
              <span
                key={e.id}
                className="absolute top-1 h-3.5 w-[2px] rounded-full"
                style={{ left: x, background: TICK_COLOR[g.tone] ?? "var(--color-kelp)", opacity: e.at <= t ? 0.95 : 0.3 }}
                title={`${e.title}: ${e.detail}`}
              />
            );
          })}
          {/* track */}
          <span className="absolute inset-x-0 top-[26px] h-[3px] rounded-full bg-shelf/70" />
          <motion.span className="absolute left-0 top-[26px] h-[3px] rounded-full bg-sodium/80" animate={{ width: pos }} transition={{ duration: 0 }} />
          {/* handle */}
          <motion.span
            className="absolute top-[18px] grid h-[19px] w-[19px] -translate-x-1/2 place-items-center rounded-full border-2 border-sodium bg-abyss shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-sodium)_18%,transparent)]"
            animate={{ left: pos }}
            transition={dragging || playing ? { duration: 0 } : spring.snap}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sodium" />
          </motion.span>
          <span className="data absolute bottom-[-2px] left-0 text-[10.5px] text-kelp">{day(start)}</span>
          <span className="data absolute bottom-[-2px] right-0 text-[10.5px] text-kelp">now</span>
        </div>
      </div>
      <div className="w-[132px] shrink-0 text-right">
        <p className="label">As of</p>
        <p className={cx("mt-1 text-[13.5px] font-[600]", value === null ? "text-foam" : "text-sodium")}>
          {value === null ? "Now" : `${day(t)} · ${relTime(t, now)}`}
        </p>
      </div>
    </div>
  );
}
