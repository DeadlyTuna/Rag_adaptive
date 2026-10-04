"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Pin, PinOff, Trash2, X, Archive } from "lucide-react";
import { Glyph, CLASS_LABEL } from "@/components/ui/Glyph";
import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/motion-bits";
import { Palimpsest } from "@/components/ui/Palimpsest";
import { ForgettingCurve } from "./ForgettingCurve";
import { VersionChain } from "./VersionChain";
import { useNow, useStore } from "@/lib/store";
import { dayYear, relTime, untilText, cx } from "@/lib/format";
import { statusAt } from "@/lib/engine/forget";
import { docTitle } from "@/lib/engine/classify";
import { versionChains } from "@/lib/selectors";
import { spring } from "@/lib/motion";
import type { Chunk, Memory, World } from "@/lib/engine/types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-t hairline py-2.5">
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-[13.5px] text-foam">{children}</dd>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px]",
        status === "current" ? "border-shelf text-foam" : "border-shelf/60 text-kelp",
      )}
    >
      <Glyph name={status === "current" ? "confirm" : status === "expired" ? "expired" : "outdated"} size={12} />
      {status === "current" ? "Current" : status === "expired" ? "Expired" : "Outdated"}
    </span>
  );
}

function MemoryBody({ m, world, now }: { m: Memory; world: World; now: number }) {
  const [confirming, setConfirming] = useState(false);
  const { pin, outdate, remove, openMemory } = useStore.getState();
  const busy = useStore((s) => !!s.pending);
  const st = statusAt(m, now);
  const replacedBy = m.supersededBy ? world.memories.find((x) => x.id === m.supersededBy) : undefined;
  const replaces = m.supersedes && !m.supersedes.startsWith("chunk:") ? world.memories.find((x) => x.id === m.supersedes) : undefined;
  const replacesChunk = m.supersedes?.startsWith("chunk:") ? world.chunks.find((c) => c.id === m.supersedes!.slice(6)) : undefined;
  const chain = m.slot ? versionChains(world, now).find((c) => c.slot === m.slot) : undefined;
  const glyph = m.kind === "preference" ? "preference" : m.cls;

  return (
    <>
      <div className="px-6 pb-5 pt-2">
        <p className={cx("text-[22px] font-[620] leading-snug tracking-[-0.01em]", st !== "current" && "text-kelp line-through decoration-kelp/60")}>
          {m.value && m.previousValue && st === "current" ? (
            <>
              {m.label}: <Palimpsest current={m.value} previous={m.previousValue} />
            </>
          ) : (
            m.text
          )}
        </p>
        {replacedBy && (
          <button type="button" onClick={() => openMemory(replacedBy.id)} className="mt-2 text-left text-[13px] text-kelp hover:text-foam">
            Replaced by <span className="text-foam underline decoration-shelf underline-offset-4">{replacedBy.text}</span> on {dayYear(m.supersededAt!)}
          </button>
        )}
        {(replaces || replacesChunk) && (
          <p className="mt-2 text-[13px] text-kelp">
            Replaces{" "}
            {replaces ? (
              <button type="button" onClick={() => openMemory(replaces.id)} className="text-foam underline decoration-shelf underline-offset-4 hover:decoration-kelp">
                {replaces.text}
              </button>
            ) : (
              <span className="text-foam">
                {m.previousValue} from {docTitle(world, replacesChunk!.docId)} §{replacesChunk!.section}
              </span>
            )}
          </p>
        )}
        {m.utterance && (
          <blockquote className="mono mt-4 rounded-[10px] border border-shelf bg-abyss/50 px-3 py-2.5 text-[12.5px] text-kelp">
            <span className="label mb-1 block">{m.source.type === "user" ? "You said" : "Source text"}</span>
            “{m.utterance}”
          </blockquote>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 px-6">
        <Field label="Knowledge">{m.label}</Field>
        <Field label="Source">
          {m.source.type === "user" ? "Learned from you" : m.source.label}
          {m.confirmedBy && <span className="block text-[12px] text-kelp">Confirmed by {m.confirmedBy.replace("-", " §")}</span>}
        </Field>
        <Field label="Confidence">
          <span className="tnum">{m.confidence.toFixed(2)}</span>
          <Meter value={m.confidence} tone="var(--color-viz-c)" className="mt-1.5" />
        </Field>
        <Field label="Status">
          <StatusChip status={st === "future" ? "current" : st} />
        </Field>
        <Field label="Previous value">{m.previousValue ?? "—"}</Field>
        <Field label="Timestamp">
          <span className="tnum">{dayYear(m.createdAt)}</span>
        </Field>
        <Field label="Importance">
          <span className="tnum">{m.importance.toFixed(2)}</span>
          <Meter value={m.importance} tone="var(--color-viz-i)" className="mt-1.5" />
        </Field>
        <Field label="Reliability">
          <span className="tnum">{m.reliability.toFixed(2)}</span>
          <Meter value={m.reliability} tone="var(--color-viz-c)" className="mt-1.5" />
        </Field>
        <Field label="Used in answers">
          <span className="tnum">{m.uses.length}×</span>
          {m.uses.length > 0 && <span className="text-kelp"> · last {relTime(m.lastUsedAt, now)}</span>}
        </Field>
        <Field label={m.expiresAt ? "Expires" : "Pinned"}>
          {m.expiresAt ? (st === "expired" ? `Expired ${relTime(m.expiredAt ?? m.expiresAt, now)}` : untilText(m.expiresAt, now)) : m.pinned ? "Yes — never fades" : "No"}
        </Field>
      </dl>

      <div className="px-6 pt-6">
        <ForgettingCurve memory={m} now={now} />
      </div>

      {chain && (
        <div className="px-6 pt-6">
          <p className="mb-2 text-[13px] font-[600] text-foam">How this fact changed</p>
          <VersionChain chain={chain} compact />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t hairline px-6 py-4">
        <Button size="sm" onClick={() => pin(m.id)} disabled={busy || st !== "current"}>
          {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          {m.pinned ? "Unpin memory" : "Pin memory"}
        </Button>
        <Button size="sm" onClick={() => outdate(m.id)} disabled={busy || st !== "current"}>
          <Archive size={14} /> Mark outdated
        </Button>
        {confirming ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[12.5px] text-kelp">Delete for good?</span>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => remove(m.id)}>
              Delete memory
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Delete memory
          </Button>
        )}
      </div>
      <span className="sr-only">{CLASS_LABEL[glyph === "preference" ? "persistent" : m.cls]}</span>
    </>
  );
}

function ChunkBody({ c, world }: { c: Chunk; world: World }) {
  const overrides = Object.entries(c.overriddenBy ?? {})
    .map(([slot, id]) => ({ slot, m: world.memories.find((x) => x.id === id) }))
    .filter((o) => o.m);
  return (
    <div className="px-6 pb-6 pt-2">
      <p className="text-[20px] font-[620] leading-snug">{c.title}</p>
      <p className="mt-1 text-[13px] text-kelp">
        {docTitle(world, c.docId)} · §{c.section}
      </p>
      <p className="mt-4 text-[14.5px] leading-relaxed text-foam/90">{c.text}</p>
      {overrides.map((o) => (
        <p key={o.slot} className="mt-4 flex items-start gap-2 rounded-[10px] border border-shelf bg-abyss/50 px-3 py-2.5 text-[13px] text-kelp">
          <Glyph name="correction" className="mt-0.5 shrink-0 text-sodium" />
          <span>
            Overridden for {o.m!.label.toLowerCase()} by <span className="text-foam">{o.m!.text}</span>
          </span>
        </p>
      ))}
      <dl className="mt-4 grid grid-cols-2 gap-x-6">
        <Field label="Published">{dayYear(c.publishedAt)}</Field>
        <Field label="Indexed">{dayYear(c.indexedAt)}</Field>
        <Field label="Reliability">
          <span className="tnum">{c.reliability.toFixed(2)}</span>
          <Meter value={c.reliability} tone="var(--color-viz-c)" className="mt-1.5" />
        </Field>
        <Field label="Importance">
          <span className="tnum">{c.importance.toFixed(2)}</span>
          <Meter value={c.importance} tone="var(--color-viz-i)" className="mt-1.5" />
        </Field>
        <Field label="Size">{c.tokens} tokens</Field>
        <Field label="Facts it states">{c.claims.length ? c.claims.map((cl) => cl.value).join(", ") : "—"}</Field>
      </dl>
    </div>
  );
}

export function MemoryDrawer() {
  const id = useStore((s) => s.drawerId);
  const world = useStore((s) => s.world);
  const close = () => useStore.getState().openMemory(null);
  const now = useNow(5000);
  const memory = id ? world.memories.find((m) => m.id === id) : undefined;
  const chunk = id && !memory ? world.chunks.find((c) => c.id === id) : undefined;
  const open = !!(memory || chunk);
  const st = memory ? statusAt(memory, now) : null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[55] bg-abyss/55 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.aside
                className="fixed inset-y-0 right-0 z-[56] flex w-[min(500px,100vw)] flex-col border-l border-shelf bg-trench shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.6)] outline-none"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%", transition: { duration: 0.22, ease: [0.55, 0, 1, 0.45] } }}
                transition={spring.fluid}
              >
                <header className="flex items-center gap-3 px-6 pb-2 pt-5">
                  {memory ? (
                    <>
                      <Glyph
                        name={memory.kind === "preference" ? "preference" : memory.cls}
                        className={memory.cls === "correction" ? "text-sodium" : "text-rhodamine"}
                      />
                      <Dialog.Title className="label text-foam">
                        {memory.kind === "preference" ? "Preference" : memory.kind === "profile" ? "About you" : CLASS_LABEL[memory.cls]} memory
                      </Dialog.Title>
                      <StatusChip status={st === "future" || !st ? "current" : st} />
                    </>
                  ) : (
                    <>
                      <Glyph name="document" className="text-glacier" />
                      <Dialog.Title className="label text-foam">Document passage</Dialog.Title>
                    </>
                  )}
                  <Dialog.Close asChild>
                    <button type="button" aria-label="Close" className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-kelp hover:bg-reef hover:text-foam">
                      <X size={16} />
                    </button>
                  </Dialog.Close>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                  {memory && <MemoryBody key={memory.id} m={memory} world={world} now={now} />}
                  {chunk && <ChunkBody c={chunk} world={world} />}
                </div>
              </motion.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
