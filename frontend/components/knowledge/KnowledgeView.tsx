"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { FileUp, Sparkles } from "lucide-react";
import type { SeedDocument } from "@/lib/engine/corpus";
import type { IngestResult } from "@/lib/api/live";
import { SAMPLE_CIRCULAR } from "@/lib/engine/corpus";
import { parseUpload } from "@/lib/engine/engine";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { Meter } from "@/components/ui/motion-bits";
import { LazyTerrain, TerrainLegend } from "@/components/terrain/LazyTerrain";
import { IngestSequence } from "./IngestSequence";
import { Fingerprint } from "./Fingerprint";
import { terrainItems } from "@/lib/selectors";
import { cx, dayYear } from "@/lib/format";
import { LIVE, live } from "@/lib/api/live";
import { useHydrated, useNow, useStore } from "@/lib/store";

/** The server's chunks, in the shape the ingest animation walks through. */
function toSeedDocument(r: IngestResult): SeedDocument {
  const d = r.document!;
  return {
    id: d.id,
    title: d.title,
    issuer: d.issuer,
    published: new Date(d.publishedAt).toISOString().slice(0, 10),
    sections: r.chunks.map((c) => ({ section: c.section, title: c.title, text: c.text, importance: c.importance, claims: c.claims })),
  };
}

export function KnowledgeView() {
  const hydrated = useHydrated();
  const world = useStore((s) => s.world);
  const ingest = useStore((s) => s.ingest);
  const open = useStore((s) => s.openMemory);
  const hoverId = useStore((s) => s.hoverId);
  const hover = useStore((s) => s.hover);
  const pulse = useStore((s) => s.pulse);
  const now = useNow(60_000);
  const [selected, setSelected] = useState<string>("regs");
  const [incoming, setIncoming] = useState<SeedDocument | null>(null);
  // live mode: an upload is already indexed by the time it animates — just show the result
  const uploaded = useRef<IngestResult | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doc = world.documents.find((d) => d.id === selected) ?? world.documents[0];
  const chunks = useMemo(() => world.chunks.filter((c) => c.docId === doc?.id), [world, doc]);
  const items = useMemo(() => terrainItems(world, now), [world, now]);
  const highlight = useMemo(() => chunks.slice(0, 6).map((c) => c.id), [chunks]);
  const hasSample = world.documents.some((d) => d.id === SAMPLE_CIRCULAR.id);

  const start = (d: SeedDocument) => {
    if (world.documents.some((x) => x.id === d.id)) {
      setError(`“${d.title}” is already in the knowledge base.`);
      return;
    }
    setError(null);
    setIncoming(d);
  };

  const onFiles = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (LIVE) {
      try {
        const r = await live.upload(f);
        if (r.alreadyIndexed || !r.document) {
          setError(`“${f.name}” is already in the knowledge base.`);
          return;
        }
        setError(null);
        uploaded.current = r;
        setIncoming(toSeedDocument(r));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
      return;
    }
    if (!/\.(txt|md|markdown)$/i.test(f.name)) {
      setError("The demo engine reads .txt and .md files. PDFs need the FastAPI backend (it extracts the text server-side).");
      return;
    }
    const text = await f.text();
    if (!text.trim()) {
      setError(`“${f.name}” is empty — add some text and try again.`);
      return;
    }
    start(parseUpload(f.name, text, Date.now()));
  };

  if (!hydrated) return <div className="min-h-[60vh]" aria-busy="true" />;

  return (
    <div className="mx-auto max-w-[1680px] space-y-5 px-4 py-6 sm:px-6">
      <header>
        <p className="label">Knowledge base</p>
        <h1 className="t-display-m mt-2 text-foam" style={{ ["--wdth" as string]: 108 }}>
          The documents it answers from
        </h1>
        <p className="mt-2 max-w-2xl text-[14.5px] text-kelp">
          Official regulations are split into passages, embedded, and indexed. Memories can override a passage’s claim — the passage stays, marked
          with what replaced it.
        </p>
      </header>

      {/* drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onFiles(e.dataTransfer.files);
        }}
        className={cx(
          "relative overflow-hidden rounded-[16px] border-[1.5px] border-dashed p-5 transition-colors duration-200",
          drag ? "border-sodium bg-sodium/[0.06]" : "border-shelf bg-trench/40",
        )}
      >
        <AnimatePresence mode="wait">
          {incoming ? (
            <motion.div key="ingest" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
              <IngestSequence
                doc={incoming}
                onIndexed={() => {
                  setSelected(incoming.id);
                  if (LIVE) {
                    const done = uploaded.current;
                    uploaded.current = null;
                    if (done) void useStore.getState().applyIngest(done);
                    else
                      void useStore
                        .getState()
                        .ingestSampleLive()
                        .then((r) => r?.alreadyIndexed && setError("That document is already indexed."));
                    return;
                  }
                  const r = ingest(incoming);
                  if (!r.chunkIds.length) setError("That document is already indexed.");
                }}
                onFinished={() => setIncoming(null)}
              />
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center gap-4">
              <span className="grid h-11 w-11 place-items-center rounded-full border border-shelf bg-abyss text-kelp">
                <FileUp size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-[600] text-foam">Drop a {LIVE ? ".txt, .md or .pdf" : ".txt or .md"} file to add it</p>
                <p className="text-[13px] text-kelp">It’s split into passages, embedded and indexed — new peaks rise on the map.</p>
              </div>
              <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.pdf" className="sr-only" onChange={(e) => onFiles(e.target.files)} />
              <Button onClick={() => fileRef.current?.click()}>Choose a file</Button>
              <Button variant="primary" disabled={hasSample} onClick={() => start(SAMPLE_CIRCULAR)} title={hasSample ? "Already added" : undefined}>
                <Sparkles size={15} /> {hasSample ? "Sample circular added" : "Add the sample CSE circular"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        {error && (
          <p role="alert" className="mt-3 flex items-center gap-2 text-[13px] text-flare">
            <Glyph name="flag" size={14} /> {error}
          </p>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)_380px]">
        <Panel title="Documents" meta={<span className="data text-kelp">{world.documents.length}</span>}>
          <ul className="p-2">
            {world.documents.map((d) => {
              const on = d.id === doc?.id;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(d.id)}
                    aria-pressed={on}
                    className={cx("relative w-full rounded-[10px] px-3 py-2.5 text-left transition-colors", on ? "bg-reef" : "hover:bg-reef/50")}
                  >
                    {on && <motion.span layoutId="doc-active" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-glacier" />}
                    <span className="flex items-center gap-2">
                      <Glyph name="document" size={14} className="text-glacier" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-[560] text-foam">{d.title}</span>
                      <span className="data text-kelp">{d.chunkIds.length}</span>
                    </span>
                    <span className="mt-0.5 block truncate pl-[22px] text-[11.5px] text-kelp">
                      {d.issuer} · {dayYear(d.publishedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title={doc ? `Passages · ${doc.title}` : "Passages"} meta={<span className="data text-kelp">{chunks.length}</span>}>
          <ul className="divide-y divide-shelf/60">
            <AnimatePresence initial={false}>
              {chunks.map((c, i) => {
                const overrides = Object.entries(c.overriddenBy ?? {})
                  .map(([slot, id]) => ({ slot, m: world.memories.find((m) => m.id === id) }))
                  .filter((o) => o.m && o.m.status === "current");
                return (
                  <motion.li
                    key={c.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onPointerEnter={() => hover(c.id)}
                    onPointerLeave={() => hover(null)}
                  >
                    <button
                      type="button"
                      onClick={() => open(c.id)}
                      className={cx("grid w-full grid-cols-[48px_minmax(0,1fr)] gap-3 px-4 py-3 text-left transition-colors", hoverId === c.id ? "bg-reef/70" : "hover:bg-reef/40")}
                    >
                      <span className="data pt-0.5 text-[12px] text-kelp">§{c.section}</span>
                      <span className="min-w-0">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[13.5px] font-[600] text-foam">{c.title}</span>
                          <span className="data shrink-0 text-[11px] text-kelp">{c.tokens} tokens</span>
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[12.5px] leading-relaxed text-kelp">{c.text}</span>
                        <span className="mt-2 flex items-center gap-3">
                          <Fingerprint text={`${c.title}. ${c.text}`} className="flex h-2.5 w-[200px] max-w-[50%] gap-[2px]" />
                          <span className="flex flex-1 items-center gap-2">
                            <span className="label shrink-0">Reliability</span>
                            <Meter value={c.reliability} tone="var(--color-viz-c)" className="max-w-[120px]" />
                            <span className="data text-[11px] text-foam">{c.reliability.toFixed(2)}</span>
                          </span>
                        </span>
                        {overrides.map((o) => (
                          <span key={o.slot} className="mt-2 flex items-center gap-1.5 text-[12px] text-kelp">
                            <Glyph name="correction" size={13} className="text-sodium" />
                            Overridden for {o.m!.label.toLowerCase()} by <span className="text-foam">{o.m!.text}</span>
                          </span>
                        ))}
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </Panel>

        <Panel title="Where it sits on the map">
          <LazyTerrain
            items={items}
            mode="flat"
            pulse={pulse}
            highlight={highlight}
            hoverId={hoverId}
            onHover={hover}
            onSelect={open}
            compactLabels
            ariaLabel={`Memory map with the passages of ${doc?.title ?? "the selected document"} highlighted.`}
            className="h-[300px]"
          />
          <div className="border-t hairline px-4 py-3">
            <TerrainLegend />
            <p className="mt-2 text-[12px] text-kelp">Rings mark this document’s passages. Similar passages sit close together.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
