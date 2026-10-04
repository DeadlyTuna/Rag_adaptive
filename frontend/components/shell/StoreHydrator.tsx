"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";

/** Restores the demo from localStorage once, and lets real time expire temporary memories. */
export function StoreHydrator() {
  useEffect(() => {
    if (!useStore.getState().hydrated) {
      const r = useStore.persist.rehydrate();
      Promise.resolve(r).finally(() => {
        useStore.setState({ hydrated: true });
        useStore.getState().tickNow();
      });
    }
    const id = setInterval(() => useStore.getState().tickNow(), 20_000);
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
