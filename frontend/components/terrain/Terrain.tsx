"use client";

import { useEffect, useRef, useState } from "react";
import type { Ping, Pulse } from "@/lib/store";
import { cx } from "@/lib/format";
import { TerrainRenderer, type TerrainMode, type TItem } from "./renderer";

export interface TerrainProps {
  items: TItem[];
  mode: TerrainMode;
  ping?: Ping | null;
  pulse?: Pulse | null;
  highlight?: string[];
  hoverId?: string | null;
  forcedLabels?: string[];
  focus?: { x: number; y: number; zoom: number } | null;
  labels?: "auto" | "none";
  compactLabels?: boolean;
  interactive?: boolean;
  ambient?: boolean;
  probe?: boolean;
  intro?: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  className?: string;
  ariaLabel: string;
}

export default function Terrain({
  items,
  mode,
  ping,
  pulse,
  highlight,
  hoverId,
  forcedLabels,
  focus = null,
  labels = "auto",
  compactLabels = false,
  interactive = true,
  ambient = true,
  probe = false,
  intro = false,
  onHover,
  onSelect,
  className,
  ariaLabel,
}: TerrainProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const rRef = useRef<TerrainRenderer | null>(null);
  const cb = useRef({ onHover, onSelect });
  // client-only component (loaded with ssr:false), so the probe can run in the initializer
  const [failed] = useState(() => {
    try {
      return !document.createElement("canvas").getContext("webgl2");
    } catch {
      return true;
    }
  });

  useEffect(() => {
    cb.current = { onHover, onSelect };
  });

  // create once
  useEffect(() => {
    if (failed || !hostRef.current || !layerRef.current) return;
    let r: TerrainRenderer;
    try {
      r = new TerrainRenderer(
        hostRef.current,
        layerRef.current,
        {
          ambient,
          labelMode: labels,
          compactLabels,
          interactive,
          onHover: (id) => cb.current.onHover?.(id),
          onSelect: (id) => cb.current.onSelect?.(id),
        },
        ariaLabel,
      );
    } catch (err) {
      console.warn("Memory map unavailable:", err);
      return;
    }
    rRef.current = r;
    r.setMode(mode, true);
    r.setItems(items, true);
    if (intro) r.rise();
    return () => {
      r.dispose();
      rRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => rRef.current?.setAriaLabel(ariaLabel), [ariaLabel]);
  useEffect(() => rRef.current?.setItems(items), [items]);
  useEffect(() => rRef.current?.setMode(mode), [mode]);
  useEffect(() => rRef.current?.setAmbient(ambient), [ambient]);
  useEffect(() => rRef.current?.setLabelMode(labels), [labels]);
  useEffect(() => rRef.current?.setHighlight(highlight ?? []), [highlight]);
  useEffect(() => rRef.current?.setForcedLabels(forcedLabels ?? []), [forcedLabels]);
  useEffect(() => rRef.current?.setHover(hoverId ?? null), [hoverId]);
  useEffect(() => {
    rRef.current?.setFocus(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.x, focus?.y, focus?.zoom]);
  useEffect(() => {
    if (ping) rRef.current?.ping(ping.pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ping?.key]);
  useEffect(() => {
    if (pulse) rRef.current?.pulse(pulse.ids, pulse.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse?.key]);

  useEffect(() => {
    if (!probe) return;
    const move = (e: PointerEvent) => rRef.current?.setProbe(e.clientX, e.clientY, e.pointerType !== "touch");
    const leave = () => rRef.current?.setProbe(0, 0, false);
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, [probe]);

  return (
    <div ref={hostRef} className={cx("relative overflow-hidden", className)}>
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-kelp">
          <p className="max-w-xs">
            This browser can’t draw the memory map (WebGL 2 is unavailable). Everything on the map is also listed on this page.
          </p>
        </div>
      )}
      <div ref={layerRef} className="pointer-events-none absolute inset-0" aria-hidden />
    </div>
  );
}
