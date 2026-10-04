"use client";

import { motion } from "motion/react";
import type { Memory, World } from "@/lib/engine/types";
import { Glyph, type GlyphName } from "@/components/ui/Glyph";
import { Meter } from "@/components/ui/motion-bits";
import { statusAt, strengthAt } from "@/lib/engine/forget";
import { docTitle } from "@/lib/engine/classify";
import { shortDoc } from "@/lib/engine/retrieve";
import { cx, day, untilText } from "@/lib/format";
import { spring } from "@/lib/motion";
import { useStore } from "@/lib/store";

export function memoryGlyph(m: Memory): { name: GlyphName; tone: string } {
  if (m.kind === "preference") return { name: "preference", tone: "text-rhodamine" };
  if (m.kind === "profile") return { name: "profile", tone: "text-rhodamine" };
  if (m.cls === "correction") return { name: "correction", tone: "text-sodium" };
  if (m.cls === "temporary") return { name: "temporary", tone: "text-rhodamine" };
  return { name: "important", tone: "text-rhodamine" };
}

export function kindLabel(m: Memory) {
  if (m.kind === "preference") return "Preference";
  if (m.kind === "profile") return "About you";
  if (m.cls === "correction") return "Correction";
  if (m.cls === "temporary") return "Temporary";
  return "Important";
}

export function MemoryCard({ m, world, t }: { m: Memory; world: World; t: number }) {
  const open = useStore((s) => s.openMemory);
  const hover = useStore((s) => s.hover);
  const active = useStore((s) => s.hoverId === m.id);
  const st = statusAt(m, t);
  const strength = st === "current" ? strengthAt(m, t) : 0;
  const g = memoryGlyph(m);
  const replacedBy = m.supersededBy ? world.memories.find((x) => x.id === m.supersededBy) : undefined;
  const chunk = m.supersedes?.startsWith("chunk:") ? world.chunks.find((c) => c.id === m.supersedes!.slice(6)) : undefined;
  const provenance =
    st === "outdated"
      ? replacedBy
        ? `Replaced by “${replacedBy.text}”`
        : "Marked outdated"
      : m.previousValue
        ? `Replaces ${m.previousValue}${chunk ? ` · ${shortDoc(docTitle(world, chunk.docId))} §${chunk.section}` : ""}`
        : m.confirmedBy
          ? `Confirmed by ${m.confirmedBy.replace("circular-", "CSE Circular §")}`
          : m.source.type === "user"
            ? "Learned from you"
            : m.source.label;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: st === "current" ? 1 : 0.6, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, filter: "blur(4px)", transition: { duration: 0.35 } }}
      transition={spring.fluid}
      onPointerEnter={() => hover(m.id)}
      onPointerLeave={() => hover(null)}
    >
      <button
        type="button"
        onClick={() => open(m.id)}
        className={cx(
          "flex h-full w-full flex-col rounded-[14px] border p-3.5 text-left transition-colors",
          m.cls === "temporary" && st === "current" ? "border-dashed" : "",
          active ? "border-kelp/60 bg-reef/80" : "border-shelf bg-trench/70 hover:border-kelp/40 hover:bg-reef/50",
        )}
      >
        <span className="flex w-full items-center gap-2">
          <Glyph name={st === "current" ? g.name : st === "expired" ? "expired" : "outdated"} size={14} className={st === "current" ? g.tone : "text-kelp"} />
          <span className="label">{kindLabel(m)}</span>
          <span className="truncate text-[11.5px] text-kelp">· {m.label}</span>
          {m.pinned && <Glyph name="pin" size={13} className="text-foam" />}
          <span className={cx("ml-auto shrink-0 text-[11.5px]", st === "current" ? "text-foam" : "text-kelp")}>{st === "future" ? "" : st}</span>
        </span>
        <span className={cx("mt-2 text-[15px] font-[560] leading-snug", st === "current" ? "text-foam" : "text-kelp line-through decoration-kelp/50")}>{m.text}</span>
        <span className="mt-1 line-clamp-1 text-[12px] text-kelp">{provenance}</span>
        <span className="mt-auto flex items-center gap-3 pt-3">
          <span className="label shrink-0">Strength</span>
          <Meter value={strength} tone={st === "current" ? "var(--color-rhodamine)" : "var(--color-shelf)"} className="flex-1" />
          <span className="data w-8 text-right text-foam">{strength.toFixed(2)}</span>
        </span>
        <span className="mt-2 flex items-center justify-between text-[11.5px] text-kelp">
          <span>
            {m.source.type === "user" ? "You" : m.source.label} · {day(m.createdAt)}
          </span>
          <span className="tnum">
            {m.cls === "temporary" && m.expiresAt && st === "current" ? untilText(m.expiresAt, t) : `used ${m.uses.filter((u) => u <= t).length}×`}
          </span>
        </span>
      </button>
    </motion.li>
  );
}
