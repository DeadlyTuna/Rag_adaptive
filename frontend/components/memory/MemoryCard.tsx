"use client";

import { motion } from "motion/react";
import type { Memory, World } from "@/lib/engine/types";
import { Glyph, type GlyphName } from "@/components/ui/Glyph";
import { Meter } from "@/components/ui/motion-bits";
import { DAY, statusAt, strengthAt } from "@/lib/engine/forget";
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

/** Badges for what only the live backend's research extensions record about a memory. */
export function MemoryBadges({ m, t }: { m: Memory; t: number }) {
  const st = statusAt(m, t);
  const badges: { text: string; tone: string; title?: string }[] = [];
  if (st === "pending" && m.verification)
    badges.push({
      text: `Unverified · ${m.verification.score.toFixed(2)} < ${m.verification.threshold.toFixed(2)}`,
      tone: "border-sodium/50 text-sodium",
      title: m.verification.reasons.join("\n"),
    });
  else if (m.verification?.resolvedBy && m.verification.accepted)
    badges.push({ text: `Verified by ${m.verification.resolvedBy === "crowd" ? "students" : m.verification.resolvedBy}`, tone: "border-glacier/45 text-glacier" });
  if (m.appliesTo) badges.push({ text: `${m.appliesTo} only`, tone: "border-glacier/45 text-glacier", title: "A department's rule: it doesn't apply to other departments" });
  if (m.validFrom && m.validFrom > t) badges.push({ text: `From ${day(m.validFrom)}`, tone: "border-sodium/50 text-sodium", title: "A change announced for later" });
  else if (m.validFrom && m.validFrom < m.createdAt - DAY) badges.push({ text: `True since ${day(m.validFrom)}`, tone: "border-shelf text-kelp", title: "When it became true, not when it was learned" });
  if (m.shared) badges.push({ text: (m.reporters?.length ?? 0) > 1 ? `Shared · ${m.reporters!.length} students` : "Shared", tone: "border-shelf text-foam" });
  if (m.mergedFrom?.length) badges.push({ text: `Merged ×${m.mergedFrom.length + 1}`, tone: "border-shelf text-kelp" });
  if (st === "archived") badges.push({ text: m.mergedInto ? "Merged into another memory" : m.verification?.resolvedBy ? "Rejected" : "Archived", tone: "border-shelf text-kelp" });
  if (!badges.length) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.text} title={b.title} className={cx("rounded-full border px-1.5 py-px text-[10.5px]", b.tone)}>
          {b.text}
        </span>
      ))}
    </span>
  );
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
    st === "pending"
      ? "Held until a document or another student confirms it"
      : st === "outdated"
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
      animate={{ opacity: st === "current" ? 1 : st === "pending" ? 0.85 : 0.6, scale: 1 }}
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
          <Glyph
            name={st === "current" ? g.name : st === "pending" ? "flag" : st === "expired" || st === "archived" ? "expired" : "outdated"}
            size={14}
            className={st === "current" ? g.tone : st === "pending" ? "text-sodium" : "text-kelp"}
          />
          <span className="label">{kindLabel(m)}</span>
          <span className="truncate text-[11.5px] text-kelp">· {m.label}</span>
          {m.pinned && <Glyph name="pin" size={13} className="text-foam" />}
          <span className={cx("ml-auto shrink-0 text-[11.5px]", st === "current" ? "text-foam" : st === "pending" ? "text-sodium" : "text-kelp")}>
            {st === "future" ? "" : st === "pending" ? "unverified" : st}
          </span>
        </span>
        <span
          className={cx(
            "mt-2 text-[15px] font-[560] leading-snug",
            st === "current" ? "text-foam" : st === "pending" ? "text-foam/80" : "text-kelp line-through decoration-kelp/50",
          )}
        >
          {m.text}
        </span>
        <span className="mt-1 line-clamp-1 text-[12px] text-kelp">{provenance}</span>
        <MemoryBadges m={m} t={t} />
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
