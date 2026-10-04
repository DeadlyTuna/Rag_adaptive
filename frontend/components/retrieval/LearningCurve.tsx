"use client";

// How feedback moved the four weights. One axis (weight), x = feedback event in order.
// Legend always; direct end-labels only where they don't collide; crosshair lists all four.

import { useState } from "react";
import type { WeightPoint } from "@/lib/engine/types";
import { FACTORS } from "@/lib/engine/types";
import { FACTOR_META } from "@/lib/factors";
import { useWidth } from "@/lib/hooks";
import { day } from "@/lib/format";

const H = 230;
const PAD = { l: 36, r: 84, t: 14, b: 30 };

export function LearningCurve({ history }: { history: WeightPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const n = history.length;
  const max = Math.max(0.6, ...history.flatMap((p) => FACTORS.map((f) => p.weights[f]))) + 0.02;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (width - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const ticks = [0, 0.2, 0.4, 0.6].filter((t) => t <= max);

  // direct labels at the line ends, skipping any that would collide
  const ends = FACTORS.map((f) => ({ f, y: y(history[n - 1]?.weights[f] ?? 0) })).sort((a, b) => a.y - b.y);
  const shown = new Set<string>();
  let lastY = -Infinity;
  for (const e of ends) {
    if (e.y - lastY >= 13) {
      shown.add(e.f);
      lastY = e.y;
    }
  }

  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {FACTORS.map((f) => (
            <li key={f} className="flex items-center gap-1.5 text-[12px] text-kelp">
              <span className="inline-block h-[2px] w-4 rounded" style={{ background: FACTOR_META[f].color }} />
              {FACTOR_META[f].w} {FACTOR_META[f].name}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setTable((v) => !v)} className="text-[12px] text-kelp underline-offset-2 hover:text-foam hover:underline">
          {table ? "Show chart" : "Show as table"}
        </button>
      </figcaption>

      {table ? (
        <div className="max-h-[260px] overflow-y-auto">
          <table className="data w-full text-left">
            <thead className="sticky top-0 bg-trench text-kelp">
              <tr>
                <th className="py-1.5 font-[500]">#</th>
                <th className="font-[500]">When</th>
                {FACTORS.map((f) => (
                  <th key={f} className="text-right font-[500]">
                    {f}
                  </th>
                ))}
                <th className="pl-4 font-[500]">Feedback</th>
              </tr>
            </thead>
            <tbody className="text-foam">
              {history.map((p, i) => (
                <tr key={i} className="border-t hairline">
                  <td className="py-1.5 text-kelp">{i}</td>
                  <td>{day(p.at)}</td>
                  {FACTORS.map((f) => (
                    <td key={f} className="text-right">
                      {p.weights[f].toFixed(3)}
                    </td>
                  ))}
                  <td className="sans truncate pl-4 text-[12px] text-kelp">{p.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative">
          <svg
            width={width}
            height={H}
            className="block overflow-visible"
            role="img"
            aria-label={`Weights over ${n - 1} feedback events. Now: ${FACTORS.map((f) => `${FACTOR_META[f].name} ${history[n - 1]?.weights[f].toFixed(2)}`).join(", ")}.`}
            onPointerMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = e.clientX - r.left;
              const i = Math.round(((px - PAD.l) / (width - PAD.l - PAD.r)) * (n - 1));
              setHover(Math.max(0, Math.min(n - 1, i)));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-shelf)" strokeWidth={1} opacity={0.6} />
                <text x={PAD.l - 8} y={y(t) + 3.5} textAnchor="end" fill="var(--color-kelp)" fontSize={10} className="data">
                  {t.toFixed(1)}
                </text>
              </g>
            ))}
            <text x={PAD.l} y={H - 8} fill="var(--color-kelp)" fontSize={10} className="data">
              {history[0] ? day(history[0].at) : ""}
            </text>
            <text x={width - PAD.r} y={H - 8} textAnchor="end" fill="var(--color-kelp)" fontSize={10} className="data">
              {history[n - 1] ? `${day(history[n - 1].at)} · ${n - 1} feedback events` : ""}
            </text>
            {FACTORS.map((f) => (
              <path
                key={f}
                d={history.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.weights[f]).toFixed(1)}`).join("")}
                fill="none"
                stroke={FACTOR_META[f].color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {FACTORS.map((f) => (
              <g key={`end-${f}`}>
                <circle cx={x(n - 1)} cy={y(history[n - 1]?.weights[f] ?? 0)} r={4} fill={FACTOR_META[f].color} stroke="var(--color-trench)" strokeWidth={2} />
                {shown.has(f) && (
                  <text x={x(n - 1) + 10} y={y(history[n - 1]?.weights[f] ?? 0) + 3.5} fill="var(--color-foam)" fontSize={11} className="data">
                    {FACTOR_META[f].name} {history[n - 1]?.weights[f].toFixed(2)}
                  </text>
                )}
              </g>
            ))}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-foam)" strokeWidth={1} opacity={0.45} />
                {FACTORS.map((f) => (
                  <circle key={f} cx={x(hover)} cy={y(history[hover].weights[f])} r={4} fill={FACTOR_META[f].color} stroke="var(--color-trench)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 w-[230px] rounded-[10px] border border-shelf bg-abyss/95 px-3 py-2"
              style={{ left: Math.min(Math.max(x(hover) + 12, 0), width - 240) }}
            >
              <p className="mb-1.5 text-[11.5px] text-kelp">
                {day(history[hover].at)} · {history[hover].label}
              </p>
              {FACTORS.map((f) => (
                <p key={f} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="flex items-center gap-1.5 text-kelp">
                    <span className="inline-block h-[2px] w-3 rounded" style={{ background: FACTOR_META[f].color }} />
                    {FACTOR_META[f].name}
                  </span>
                  <span className="data font-[600] text-foam">{history[hover].weights[f].toFixed(3)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
