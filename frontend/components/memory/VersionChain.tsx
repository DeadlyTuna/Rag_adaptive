"use client";

import { motion } from "motion/react";
import { Glyph } from "@/components/ui/Glyph";
import { cx, day } from "@/lib/format";
import { ease } from "@/lib/motion";
import type { Chain } from "@/lib/selectors";
import { useStore } from "@/lib/store";

export function VersionChain({ chain, compact = false }: { chain: Chain; compact?: boolean }) {
  const open = useStore((s) => s.openMemory);
  return (
    <ol className="flex flex-wrap items-stretch gap-y-2" aria-label={`${chain.label}: ${chain.versions.length} versions`}>
      {chain.versions.map((v, i) => (
        <li key={v.id} className="flex items-stretch">
          {i > 0 && (
            <span className="flex w-8 items-center justify-center text-shelf" aria-hidden>
              <svg width="28" height="10" viewBox="0 0 28 10" fill="none">
                <motion.path
                  d="M1 5h24m-4-4 4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: i * 0.12, duration: 0.5, ease: ease.out }}
                />
              </svg>
            </span>
          )}
          <motion.button
            type="button"
            onClick={() => open(v.id)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12, duration: 0.4, ease: ease.out }}
            className={cx(
              "group flex min-w-[112px] flex-col items-start rounded-[12px] border text-left transition-colors",
              compact ? "px-3 py-2" : "px-3.5 py-2.5",
              v.current ? "border-kelp/50 bg-reef/70 hover:border-foam/50" : "border-shelf bg-abyss/40 hover:border-kelp/40",
            )}
          >
            <span className="flex items-center gap-1.5">
              <Glyph name={v.kind === "document" ? "document" : v.current ? "confirm" : "outdated"} size={12} className={v.kind === "document" ? "text-glacier" : v.current ? "text-rhodamine" : "text-kelp"} />
              <span className="label">{v.current ? "Current" : v.kind === "document" ? "Document" : "Replaced"}</span>
            </span>
            <span
              className={cx(
                "mt-1 font-[620] tracking-[-0.01em]",
                compact ? "text-[15px]" : "text-[18px]",
                v.current ? "text-foam" : "text-kelp line-through decoration-sodium/60",
              )}
            >
              {v.value}
            </span>
            <span className="mt-0.5 text-[11.5px] text-kelp">
              {v.source} · {day(v.at)} · <span className="tnum">{v.confidence.toFixed(2)}</span>
            </span>
          </motion.button>
        </li>
      ))}
    </ol>
  );
}
