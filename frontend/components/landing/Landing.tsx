"use client";

import Lenis from "lenis";
import Link from "next/link";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/ui/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { Stage, type SceneId } from "./Stage";
import { Hero } from "./Hero";
import { Problem } from "./Problem";
import { Sorter } from "./Sorter";
import { Correction } from "./Correction";
import { RankingToy } from "./RankingToy";
import { Loop } from "./Loop";
import { Architecture } from "./Architecture";
import { SectionHead } from "./SectionHead";
import { cx } from "@/lib/format";
import { useReducedMotion } from "@/lib/reduced-motion";

function useSmoothScroll() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true, autoRaf: true, anchors: { offset: -40 } });
    return () => lenis.destroy();
  }, [reduced]);
}

/** A section that becomes the active scene when it crosses the middle of the viewport. */
function Scene({ id, onEnter, children, className }: { id: SceneId; onEnter: (id: SceneId) => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onEnter(id), { rootMargin: "-48% 0px -48% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [id, onEnter]);
  return (
    <section ref={ref} id={id} className={cx("relative scroll-mt-10", className)}>
      {children}
    </section>
  );
}

function Nav() {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setSolid(y > 40));
  return (
    <header
      className={cx(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300",
        solid ? "border-b hairline bg-abyss/75 backdrop-blur-md" : "border-b border-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-[1320px] items-center gap-6 px-5 sm:px-8" aria-label="Main">
        <Link href="/" aria-label="Adaptive RAG — home">
          <Wordmark />
        </Link>
        <ul className="ml-auto hidden items-center gap-1 text-[13.5px] md:flex">
          {[
            { href: "#problem", label: "How it learns" },
            { href: "/console", label: "Console" },
            { href: "/memory", label: "Memory" },
            { href: "/retrieval", label: "Retrieval lab" },
            { href: "/knowledge", label: "Knowledge" },
          ].map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="rounded-full px-3 py-2 text-kelp transition-colors hover:text-foam">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <ButtonLink href="/console" variant="primary" size="sm" className="ml-auto rounded-full px-4 md:ml-2">
          Open the console
        </ButtonLink>
      </nav>
    </header>
  );
}

function Cta() {
  return (
    <div className="mx-auto flex min-h-[80svh] max-w-[1320px] flex-col items-start justify-center px-5 py-[14vh] sm:px-8">
      <SectionHead
        eyebrow="Try it"
        words={[{ text: "Tell" }, { text: "it" }, { text: "something" }, { text: "it" }, { text: "doesn’t" }, { text: "know.", wdth: 128 }]}
      >
        <p>The console runs a guided demo: ask about attendance, correct it, and watch the memory map change underneath the answer.</p>
      </SectionHead>
      <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.5 }} className="mt-9 flex flex-wrap gap-3">
        <ButtonLink href="/console" variant="primary" size="lg">
          Open the console
        </ButtonLink>
        <ButtonLink href="/memory" size="lg" className="rounded-full">
          Explore the memory
        </ButtonLink>
      </motion.div>
    </div>
  );
}

export function Landing() {
  useSmoothScroll();
  const [scene, setScene] = useState<SceneId>("hero");
  const [corrected, setCorrected] = useState(false);
  const [sorted, setSorted] = useState(0);
  const onEnter = useCallback((id: SceneId) => setScene(id), []);
  const onCorrected = useCallback((v: boolean) => setCorrected(v), []);
  const onSorted = useCallback((n: number) => setSorted(n), []);

  return (
    <>
      <Stage scene={scene} corrected={corrected} sorted={sorted} />
      <Nav />
      <main className="relative z-10">
        <Scene id="hero" onEnter={onEnter}>
          <Hero onCorrected={onCorrected} />
        </Scene>
        <Scene id="problem" onEnter={onEnter}>
          <Problem />
        </Scene>
        <Scene id="remember" onEnter={onEnter}>
          <Sorter onSorted={onSorted} />
        </Scene>
        <Scene id="correct" onEnter={onEnter}>
          <Correction />
        </Scene>
        <Scene id="rank" onEnter={onEnter}>
          <RankingToy />
        </Scene>
        <Scene id="loop" onEnter={onEnter}>
          <Loop />
        </Scene>
        <Scene id="architecture" onEnter={onEnter}>
          <Architecture />
        </Scene>
        <Scene id="cta" onEnter={onEnter}>
          <Cta />
        </Scene>
      </main>
      <footer className="relative z-10 border-t hairline bg-abyss/90">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-[12.5px] text-kelp sm:px-8">
          <Wordmark />
          <p>A retrieval system that remembers, corrects and re-ranks — the language model stays unchanged.</p>
          <p className="mono">Next.js · three.js · Motion</p>
        </div>
      </footer>
    </>
  );
}
