"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { LIVE } from "@/lib/api/live";

/**
 * Restores the demo from localStorage once, and lets real time expire temporary memories.
 * In live mode the server owns the world: fetch it on load and poll while idle.
 */
export function StoreHydrator() {
  useEffect(() => {
    const step = () => {
      const s = useStore.getState();
      if (s.pending) return;
      if (LIVE) void s.refresh();
      else s.tickNow();
    };
    if (!useStore.getState().hydrated) {
      const r = useStore.persist.rehydrate();
      Promise.resolve(r).finally(() => {
        useStore.setState({ hydrated: true });
        if (LIVE) void useStore.getState().refresh({ toast: false });
        else useStore.getState().tickNow();
      });
    }
    const id = setInterval(step, 20_000);
    return () => clearInterval(id);
  }, []);
  return null;
}

/** Screen-reader announcements for memory changes. */
export function LiveRegion() {
  const announce = useStore((s) => s.announce);
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announce}
    </div>
  );
}
