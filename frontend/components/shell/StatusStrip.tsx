"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import Link from "next/link";
import { Kbd } from "@/components/ui/Button";
import { LogoMark } from "@/components/ui/Logo";
import { NAV } from "./Rail";
import { PresentationButton } from "./PresentationButton";
import { DAY, HOUR } from "@/lib/engine/forget";
import { cx, weekdayClock } from "@/lib/format";
import { ease } from "@/lib/motion";
import { useHydrated, useNow, useStore } from "@/lib/store";
import { LIVE, live } from "@/lib/api/live";
import type { Health } from "@/lib/api/live";

/** Live mode: which model writes the answers (or "template" when no LLM is configured). */
function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (!LIVE) return;
    let stale = false;
    const load = () =>
      live
        .health()
        .then((h) => {
          if (stale) return;
          setHealth(h);
          setDown(false);
        })
        .catch(() => !stale && setDown(true));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);
  return { health, down };
}

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

/** Live mode with the multi-student extension: who is talking. Each student has their own
 * conversation and private memories; shared facts are visible to everyone they apply to. */
function StudentSwitcher() {
  const users = useStore((s) => s.world.users);
  const multi = useStore((s) => !!s.world.novelties?.includes("multi_user"));
  const student = useStore((s) => s.student);
  const setStudent = useStore((s) => s.setStudent);
  const busy = useStore((s) => !!s.pending);
  if (!LIVE || !multi || !users?.length) return null;
  return (
    <label className="flex items-center gap-2 text-[12px] text-kelp" title="Switch student: each has their own conversation and private memories">
      <span className="label hidden xl:inline">Student</span>
      <select
        value={student ?? users[0].id}
        disabled={busy}
        onChange={(e) => setStudent(e.target.value)}
        className="h-8 rounded-[9px] border border-shelf bg-trench/70 px-2 text-[12.5px] text-foam outline-none transition-colors hover:border-kelp/50 focus-visible:border-kelp disabled:opacity-50"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.department ? ` · ${u.department}` : " · no department"}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StatusStrip() {
  const path = usePathname();
  const page = NAV.find((n) => path?.startsWith(n.href));
  const { health, down } = useHealth();
  const answers = health ? (health.answers === "template" ? "template answers" : health.answers) : null;
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
        <StudentSwitcher />
        <PresentationButton />
        <DemoClock />
        <span
          className={cx(
            "hidden items-center gap-2 rounded-full border border-shelf px-2.5 py-1 text-[11.5px] lg:inline-flex",
            LIVE ? "text-foam" : "text-kelp",
          )}
          title={
            LIVE
              ? down
                ? `Can't reach the FastAPI backend at ${process.env.NEXT_PUBLIC_API_URL}.`
                : `Connected to the FastAPI backend.${health ? ` Answers: ${health.answers} · classifier: ${health.classifier} · embeddings: ${health.embedder} · ${health.vectorStore}.` : ""}`
              : "Everything runs in your browser. Set NEXT_PUBLIC_API_URL to connect the FastAPI backend."
          }
        >
          <span className={cx("h-1.5 w-1.5 rounded-full", LIVE ? (down ? "bg-flare" : "bg-glacier") : "bg-rhodamine")} />
          {LIVE ? (down ? "API unreachable" : answers ? `Live API · ${answers}` : "Live API") : "Demo engine"}
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
