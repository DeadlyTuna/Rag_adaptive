"use client";

// Forgetting curve: strength over time, with rehearsal bumps at each use.
// One series → no legend; the title names it. Crosshair + tooltip; table view below.

import { useMemo, useState } from "react";
import type { Memory } from "@/lib/engine/types";
import { DAY, FORGET_THRESHOLD, forgettingCurve, strengthAt } from "@/lib/engine/forget";
import { useWidth } from "@/lib/hooks";
import { day, dayYear } from "@/lib/format";

const H = 150;
const PAD = { l: 30, r: 12, t: 12, b: 24 };

export function ForgettingCurve({ memory, now }: { memory: Memory; now: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(420);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const until = memory.expiresAt && !memory.pinned ? Math.max(memory.expiresAt + DAY / 2, now) : now + 21 * DAY;
  const start = memory.createdAt;
  const pts = useMemo(() => forgettingCurve(memory, until, 160), [memory, until]);
  const W = width;
  const x = (t: number) => PAD.l + ((t - start) / (until - start)) * (W - PAD.l - PAD.r);
  const y = (s: number) => PAD.t + (1 - s) * (H - PAD.t - PAD.b);

  const past = pts.filter((p) => p.t <= now);
  const future = pts.filter((p) => p.t >= now);
  const line = (ps: { t: number; s: number }[]) => ps.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.s).toFixed(1)}`).join("");
  const area = past.length ? `${line(past)}L${x(past[past.length - 1].t)},${y(0)}L${x(past[0].t)},${y(0)}Z` : "";
  const nowS = strengthAt(memory, now);
  const hoverT = hover !== null ? start + ((hover - PAD.l) / (W - PAD.l - PAD.r)) * (until - start) : null;
  const hoverS = hoverT !== null ? strengthAt(memory, hoverT) : null;

  const ticks = [0, 0.5, 1];
  const xTicks = [start, now, until].filter((t, i, a) => i === 0 || Math.abs(x(t) - x(a[i - 1])) > 60);

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-[600] text-foam">Strength over time</span>
        <button type="button" onClick={() => setTable((v) => !v)} className="text-[12px] text-kelp underline-offset-2 hover:text-foam hover:underline">
          {table ? "Show chart" : "Show as table"}
        </button>
      </figcaption>
      {table ? (
        <table className="data w-full text-left">
          <thead className="text-kelp">
            <tr>
              <th className="py-1 font-[500]">When</th>
              <th className="py-1 font-[500]">Event</th>
              <th className="py-1 text-right font-[500]">Strength</th>
            </tr>
          </thead>
          <tbody className="text-foam">
            <tr className="border-t hairline">
              <td className="py-1">{dayYear(start)}</td>
              <td>Learned</td>
              <td className="text-right">{strengthAt(memory, start).toFixed(2)}</td>
            </tr>
            {memory.uses.map((u) => (
              <tr key={u} className="border-t hairline">
                <td className="py-1">{dayYear(u)}</td>
                <td>Used in an answer</td>
                <td className="text-right">{strengthAt(memory, u).toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t hairline">
              <td className="py-1">{dayYear(now)}</td>
              <td>Now</td>
              <td className="text-right">{nowS.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div ref={ref} className="relative">
          <svg
            width={W}
            height={H}
            className="block overflow-visible"
            role="img"
            aria-label={`Strength ${nowS.toFixed(2)} now; ${memory.uses.length} uses since it was learned.`}
            onPointerMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = Math.max(PAD.l, Math.min(W - PAD.r, e.clientX - r.left));
              setHover(px);
            }}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-shelf)" strokeWidth={1} opacity={0.6} />
                <text x={PAD.l - 8} y={y(t) + 3.5} textAnchor="end" className="data" fill="var(--color-kelp)" fontSize={10}>
                  {t.toFixed(1)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="data" fill="var(--color-kelp)" fontSize={10}>
                {t === now ? "now" : day(t)}
              </text>
            ))}
            {/* forget threshold */}
            <line x1={PAD.l} x2={W - PAD.r} y1={y(FORGET_THRESHOLD)} y2={y(FORGET_THRESHOLD)} stroke="var(--color-kelp)" strokeDasharray="3 4" strokeWidth={1} opacity={0.7} />
            <text x={W - PAD.r} y={y(FORGET_THRESHOLD) - 5} textAnchor="end" fill="var(--color-kelp)" fontSize={10} className="data">
              forgotten below {FORGET_THRESHOLD}
            </text>
            <path d={area} fill="var(--color-rhodamine)" opacity={0.1} />
            <path d={line(past)} fill="none" stroke="var(--color-rhodamine)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={line(future)} fill="none" stroke="var(--color-rhodamine)" strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" opacity={0.45} />
            {/* now */}
            <line x1={x(now)} x2={x(now)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-sodium)" strokeWidth={1} opacity={0.7} />
            {/* rehearsals */}
            {memory.uses
              .filter((u) => u >= start && u <= until)
              .map((u) => (
                <circle key={u} cx={x(u)} cy={y(strengthAt(memory, u))} r={4} fill="var(--color-rhodamine)" stroke="var(--color-trench)" strokeWidth={2} />
              ))}
            <circle cx={x(now)} cy={y(nowS)} r={4.5} fill="var(--color-sodium)" stroke="var(--color-trench)" strokeWidth={2} />
            {hover !== null && hoverS !== null && (
              <g pointerEvents="none">
                <line x1={hover} x2={hover} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-foam)" strokeWidth={1} opacity={0.5} />
                <circle cx={hover} cy={y(hoverS)} r={4} fill="var(--color-foam)" stroke="var(--color-trench)" strokeWidth={2} />
              </g>
            )}
          </svg>
          {hover !== null && hoverS !== null && hoverT !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-[8px] border border-shelf bg-abyss/95 px-2.5 py-1.5"
              style={{ left: Math.min(hover + 10, W - 130) }}
            >
              <p className="data font-[620] text-foam">{hoverS.toFixed(2)}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-kelp">
                <span className="inline-block h-[2px] w-3 rounded bg-rhodamine" />
                {hoverT > now ? "projected · " : ""}
                {dayYear(hoverT)}
              </p>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
