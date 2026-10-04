"use client";

import dynamic from "next/dynamic";
import { cx } from "@/lib/format";

/** three.js stays out of the first paint: the terrain loads after the page is interactive. */
export const LazyTerrain = dynamic(() => import("./Terrain"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-[inherit] bg-trench/40" />,
});

export function TerrainLegend({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-2 text-[11px] text-kelp", className)} aria-label="Map colour scale: documents to learned memory">
      <span>Documents</span>
      <span
        className="h-[6px] w-20 rounded-full"
        style={{ background: "linear-gradient(90deg, var(--color-glacier), var(--color-foam), var(--color-rhodamine))" }}
      />
      <span>Learned memory</span>
      <span className="ml-2 hidden items-center gap-1.5 sm:flex">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <circle cx="7" cy="7" r="5" fill="none" stroke="var(--color-kelp)" strokeDasharray="2 2" />
        </svg>
        Outdated
      </span>
    </div>
  );
}
