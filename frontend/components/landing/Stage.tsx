"use client";

// The fixed 3-D stage behind the landing page. Each section sets a scene; the terrain
// glides between them. Built from a pristine world plus the real engine's response to
// the hero story, so every peak and change is genuine.

import { motion } from "motion/react";
import { useMemo } from "react";
import { createWorld } from "@/lib/engine/seed";
import { expandQuery, processMessage } from "@/lib/engine/engine";
import { retrieve } from "@/lib/engine/retrieve";
import { isQuestion } from "@/lib/engine/text";
import type { Classification } from "@/lib/engine/types";
import { terrainItems, type TerrainItem } from "@/lib/selectors";
import { LazyTerrain } from "@/components/terrain/LazyTerrain";
import type { TerrainMode } from "@/components/terrain/renderer";

export type SceneId = "hero" | "problem" | "remember" | "correct" | "rank" | "loop" | "architecture" | "cta";

const LANDING_NOW = Date.now();

export function useLandingData() {
  return useMemo(() => {
    const now = LANDING_NOW;
    const w0 = createWorld(now);
    const a = processMessage(w0, "What is the minimum attendance requirement?", now);
    const b = processMessage(a.world, "Our department changed it to 80% last semester.", now + 60_000);
    const t = now + 120_000;
    const memId = b.ops[0]?.memoryId ?? "";
    const q = "When can I write my FAT?";
    const hits = retrieve(b.world, expandQuery(q, { isQuestion: isQuestion(q) } as Classification), b.world.weights, t).candidates.map((c) => c.id);
    const before = terrainItems(a.world, t);
    const after = terrainItems(b.world, t).map((it) => (it.id === "regs-3.1" ? { ...it, ghost: true, w: it.w * 0.45 } : it));
    return { before, after, memId, hits, pos: b.world.positions[memId] ?? [0, 0], docPos: b.world.positions["regs-3.1"] ?? [0, 0] };
  }, []);
}

const MODE: Record<SceneId, TerrainMode> = {
  hero: "hero",
  problem: "relief",
  remember: "relief",
  correct: "relief",
  rank: "flat",
  loop: "relief",
  architecture: "hero",
  cta: "hero",
};

export function Stage({ scene, corrected, sorted }: { scene: SceneId; corrected: boolean; sorted: number }) {
  const d = useLandingData();

  const items: TerrainItem[] = useMemo(() => {
    switch (scene) {
      case "hero":
        return corrected ? d.after : d.before;
      case "problem":
        return d.before.map((it) => (it.kind === "memory" ? { ...it, w: 0, ghost: false } : it));
      case "remember":
        return d.before.map((it) => (it.kind === "memory" ? { ...it, w: it.w * Math.min(1, sorted / 5) } : it));
      case "loop":
        return d.after.map((it) => (it.id === "regs-5.2" ? { ...it, w: it.w * 0.55, ghost: true } : it));
      default:
        return d.after;
    }
  }, [scene, corrected, sorted, d]);

  const labels = useMemo(() => {
    if (scene === "correct") return [d.memId, "regs-3.1"];
    if (scene === "loop") return ["regs-5.2"];
    return [];
  }, [scene, d]);

  const focus = scene === "correct" ? { x: (d.pos[0] + d.docPos[0]) / 2, y: (d.pos[1] + d.docPos[1]) / 2, zoom: 0.62 } : null;
  const ping = scene === "rank" ? { key: 7, pos: d.pos as [number, number], ids: d.hits } : null;
  const pulse =
    scene === "correct" ? { key: 11, ids: [d.memId], kind: "replace" as const } : scene === "loop" ? { key: 12, ids: ["regs-5.2"], kind: "flag" as const } : null;
  const dim = scene !== "hero" && scene !== "cta";

  return (
    <div className="fixed inset-0 z-0">
      <LazyTerrain
        items={items}
        mode={MODE[scene]}
        focus={focus}
        ping={ping}
        pulse={pulse}
        highlight={scene === "rank" ? d.hits.slice(0, 4) : undefined}
        forcedLabels={labels}
        labels={scene === "correct" || scene === "loop" ? "auto" : "none"}
        probe={scene === "hero" || scene === "cta"}
        interactive={false}
        intro
        ariaLabel="A contour map of everything the assistant knows: blue hills are document passages, pink peaks are things it learned in conversation. It reshapes as the story on this page unfolds."
        className="h-full w-full"
      />
      {/* scrims keep the copy legible over the terrain */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[38vh] bg-gradient-to-b from-abyss via-abyss/75 to-transparent" />
      {/* a calm pool behind the copy column (left on every section) */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-full bg-[radial-gradient(ellipse_62%_75%_at_18%_55%,var(--color-abyss)_0%,color-mix(in_oklab,var(--color-abyss)_78%,transparent)_42%,transparent_78%)] lg:w-[72vw]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[16vh] bg-gradient-to-t from-abyss to-transparent" />
      <motion.div
        className="pointer-events-none absolute inset-0 bg-abyss"
        initial={false}
        animate={{ opacity: dim ? 0.42 : 0 }}
        transition={{ duration: 0.8 }}
      />
    </div>
  );
}
