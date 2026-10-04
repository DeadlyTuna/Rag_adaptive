"use client";

// The brief's final architecture as a live diagram: signals flow along the edges,
// hover or focus a block to see what it does and what it's built with.

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { SectionHead } from "./SectionHead";
import { cx } from "@/lib/format";
import { useReducedMotion } from "@/lib/reduced-motion";

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  what: string;
  tech?: string;
  tone?: "doc" | "mem" | "query";
}

const NODES: Node[] = [
  { id: "user", label: "You", x: 70, y: 80, what: "Ask questions; share facts, preferences and corrections.", tone: "query" },
  { id: "qp", label: "Query processor", x: 228, y: 80, what: "Classifies the message, extracts facts, resolves “it” from context, expands the search.", tech: "Python · scikit-learn" },
  { id: "ret", label: "Adaptive retriever", x: 400, y: 80, what: "Semantic search, then re-ranking on similarity, recency, confidence and importance.", tech: "sentence-transformers" },
  { id: "vec", label: "Vector DB", x: 320, y: 230, what: "Embeddings of every passage and memory.", tech: "FAISS / Chroma", tone: "doc" },
  { id: "mem", label: "Long-term memory", x: 500, y: 230, what: "Facts, preferences and corrections — with confidence, status and history.", tech: "SQLite / PostgreSQL", tone: "mem" },
  { id: "docs", label: "Documents", x: 680, y: 230, what: "The official regulations, split into passages.", tech: "PDF → text → chunks", tone: "doc" },
  { id: "ctx", label: "Context", x: 600, y: 80, what: "The top passages and memories, plus standing preferences." },
  { id: "llm", label: "LLM", x: 765, y: 80, what: "Writes the answer from the context. Never retrained.", tech: "API or local model" },
  { id: "ans", label: "Answer", x: 928, y: 80, what: "Cites every source it used.", tone: "query" },
  { id: "fb", label: "Feedback + evaluation", x: 860, y: 380, what: "Helpful / wrong source / outdated — turned into a ranking update.", tech: "pairwise update" },
  { id: "mm", label: "Memory manager", x: 640, y: 380, what: "Adds, updates and expires memories; resolves conflicts.", tech: "FastAPI" },
  { id: "ops", label: "Add · update · expire", x: 420, y: 380, what: "Every change is logged, so knowledge has a history.", tone: "mem" },
];

const EDGES: [string, string][] = [
  ["user", "qp"],
  ["qp", "ret"],
  ["ret", "vec"],
  ["ret", "mem"],
  ["ret", "docs"],
  ["vec", "ctx"],
  ["mem", "ctx"],
  ["docs", "ctx"],
  ["ctx", "llm"],
  ["llm", "ans"],
  ["ans", "fb"],
  ["fb", "mm"],
  ["mm", "ops"],
  ["ops", "mem"],
];

const W = 1000;
const H = 450;
const BW = 132;
const BH = 42;

function path(a: Node, b: Node) {
  // simple orthogonal-ish curve between box centres
  const mx = (a.x + b.x) / 2;
  if (Math.abs(a.y - b.y) < 2) return `M${a.x + BW / 2 - 6},${a.y} L${b.x - BW / 2 + 6},${b.y}`;
  const sy = a.y < b.y ? a.y + BH / 2 : a.y - BH / 2;
  const ey = a.y < b.y ? b.y - BH / 2 : b.y + BH / 2;
  return `M${a.x},${sy} C${a.x},${(sy + ey) / 2} ${b.x},${(sy + ey) / 2} ${b.x},${ey}`.replace(/NaN/g, String(mx));
}

export function Architecture() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const cur = active ? byId[active] : null;
  const toneBorder = (t?: Node["tone"]) =>
    t === "doc" ? "border-glacier/50" : t === "mem" ? "border-rhodamine/50" : t === "query" ? "border-sodium/50" : "border-shelf";

  return (
    <div className="mx-auto max-w-[1320px] px-5 py-[16vh] sm:px-8">
      <SectionHead eyebrow="Architecture" words={[{ text: "How" }, { text: "the" }, { text: "pieces", wdth: 124 }, { text: "fit." }]}>
        <p>A FastAPI backend runs this loop; the interface you’re looking at shows every step of it. Hover a block to see what it does.</p>
      </SectionHead>

      {/* desktop diagram */}
      <div className="relative mt-10 hidden rounded-[20px] border border-shelf bg-trench/80 p-4 backdrop-blur-md md:block">
        <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
            {EDGES.map(([a, b]) => {
              const on = active === a || active === b;
              const back = a === "ops" && b === "mem";
              return (
                <g key={`${a}-${b}`}>
                  <path d={path(byId[a], byId[b])} fill="none" stroke={on ? "var(--color-foam)" : "var(--color-shelf)"} strokeWidth={on ? 1.6 : 1.3} />
                  <path
                    d={path(byId[a], byId[b])}
                    fill="none"
                    stroke={back ? "var(--color-rhodamine)" : "var(--color-sodium)"}
                    strokeWidth={1.6}
                    strokeDasharray="3 21"
                    strokeLinecap="round"
                    opacity={0.85}
                    style={{ animation: reduced ? undefined : `dash-flow ${back ? 1.1 : 0.9}s linear infinite` }}
                  />
                </g>
              );
            })}
            <text x={470} y={318} fill="var(--color-rhodamine)" fontSize={12} className="data">
              knowledge evolves ↺
            </text>
          </svg>
          {NODES.map((n) => (
            <button
              key={n.id}
              type="button"
              onPointerEnter={() => setActive(n.id)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(n.id)}
              onBlur={() => setActive(null)}
              className={cx(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-[10px] border bg-abyss px-2 text-center text-[clamp(10px,1.15vw,13px)] font-[560] text-foam transition-[border-color,box-shadow] duration-200",
                toneBorder(n.tone),
                active === n.id && "shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-foam)_10%,transparent)]",
              )}
              style={{ left: `${(n.x / W) * 100}%`, top: `${(n.y / H) * 100}%`, width: `${(BW / W) * 100}%`, height: `${(BH / H) * 100}%` }}
            >
              {n.label}
            </button>
          ))}
        </div>
        <div className="mt-3 min-h-[52px] border-t hairline px-2 pt-3">
          <AnimatePresence mode="wait">
            <motion.p key={cur?.id ?? "none"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[13.5px] text-kelp">
              {cur ? (
                <>
                  <span className="font-[600] text-foam">{cur.label}.</span> {cur.what}
                  {cur.tech && <span className="mono ml-2 text-[12px] text-kelp/90">· {cur.tech}</span>}
                </>
              ) : (
                "Amber dots are a question travelling through; the pink loop is memory feeding back into retrieval."
              )}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      {/* mobile: the same pipeline as a list */}
      <ol className="mt-8 space-y-2 md:hidden">
        {NODES.map((n, i) => (
          <li key={n.id} className={cx("rounded-[12px] border bg-trench/85 p-3", toneBorder(n.tone))}>
            <p className="text-[14px] font-[600] text-foam">
              <span className="data mr-2 text-kelp">{i + 1}</span>
              {n.label}
            </p>
            <p className="mt-0.5 text-[12.5px] text-kelp">
              {n.what}
              {n.tech && <span className="mono"> · {n.tech}</span>}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
