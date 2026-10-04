"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import Link from "next/link";
import { Kbd } from "@/components/ui/Button";
import { LogoMark } from "@/components/ui/Logo";
import { NAV } from "./Rail";
import { DAY, HOUR } from "@/lib/engine/forget";
import { cx, weekdayClock } from "@/lib/format";
import { ease } from "@/lib/motion";
import { useHydrated, useNow, useStore } from "@/lib/store";
import { LIVE } from "@/lib/api/live";

function DemoClock() {
  const now = useNow(1000);
  const offset = useStore((s) => s.clockOffset);
  const advance = useStore((s) => s.advance);
  const busy = useStore((s) => !!s.pending);
  const hydrated = useHydrated();
  const { day, time } = weekdayClock(now);
  const ahead = offset > 60_000;
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Demo clock">
      <div className="hidden text-right sm:block">
        <p className="label leading-none">{ahead ? `Demo time · ${Math.round(offset / HOUR)} h ahead` : "Demo time"}</p>
        <p className="data mt-1 h-4 overflow-hidden text-foam">
          {hydrated && (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={`${day} ${time}`}
                className="inline-block"
                initial={{ y: "100%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "-100%", opacity: 0 }}
                transition={{ duration: 0.28, ease: ease.out }}
              >
                {day} · {time}
              </motion.span>
            </AnimatePresence>
          )}
        </p>
      </div>
      <div className="flex rounded-[9px] border border-shelf bg-abyss/50 p-0.5">
        {[
          { label: "+1 h", ms: HOUR, title: "Advance the demo clock by an hour" },
          { label: "+1 d", ms: DAY, title: "Advance the demo clock by a day — temporary memories can expire" },
          { label: "+1 w", ms: 7 * DAY, title: "Advance the demo clock by a week" },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            disabled={busy}
            onClick={() => advance(b.ms)}
            title={b.title}
            className="data h-7 rounded-[7px] px-2 text-kelp transition-colors hover:bg-reef hover:text-foam disabled:opacity-40"
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StatusStrip() {
  const path = usePathname();
  const page = NAV.find((n) => path?.startsWith(n.href));
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b hairline bg-abyss/80 px-4 backdrop-blur-md sm:px-6">
      <Link href="/" aria-label="Adaptive RAG — home" className="flex items-center gap-2 md:hidden">
        <LogoMark size={26} />
        <span className="label text-foam">{page?.label ?? ""}</span>
      </Link>
      <p className="label hidden min-w-0 truncate md:block">
        Adaptive RAG <span className="text-shelf">/</span> <span className="text-foam">{page?.label ?? ""}</span>
      </p>
      <div className="ml-auto flex items-center gap-3">
        <DemoClock />
        <span
          className={cx(
            "hidden items-center gap-2 rounded-full border border-shelf px-2.5 py-1 text-[11.5px] lg:inline-flex",
            LIVE ? "text-foam" : "text-kelp",
          )}
          title={
            LIVE
              ? "Connected to the FastAPI backend (NEXT_PUBLIC_API_URL)."
              : "Everything runs in your browser. Set NEXT_PUBLIC_API_URL to connect the FastAPI backend."
          }
        >
          <span className={cx("h-1.5 w-1.5 rounded-full", LIVE ? "bg-glacier" : "bg-rhodamine")} />
          {LIVE ? "Live API" : "Demo engine"}
        </span>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("palette:open"))}
          className="flex h-8 items-center gap-2 rounded-[9px] border border-shelf bg-trench/70 pl-2.5 pr-1.5 text-[12.5px] text-kelp transition-colors hover:border-kelp/50 hover:text-foam"
        >
          <Search size={14} strokeWidth={1.8} />
          <span className="hidden sm:inline">Commands</span>
          <span className="hidden sm:inline-flex">
            <Kbd>Ctrl K</Kbd>
          </span>
        </button>
      </div>
    </header>
  );
}
