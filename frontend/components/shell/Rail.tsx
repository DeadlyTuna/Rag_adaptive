"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { LogoMark } from "@/components/ui/Logo";
import { Glyph, type GlyphName } from "@/components/ui/Glyph";
import { cx } from "@/lib/format";
import { spring } from "@/lib/motion";
import { useStore } from "@/lib/store";

export const NAV: { href: string; label: string; glyph: GlyphName; key: string }[] = [
  { href: "/console", label: "Console", glyph: "conversation", key: "C" },
  { href: "/memory", label: "Memory", glyph: "memory", key: "M" },
  { href: "/retrieval", label: "Retrieval", glyph: "weights", key: "R" },
  { href: "/knowledge", label: "Knowledge", glyph: "document", key: "K" },
];

export function Rail() {
  const path = usePathname();
  const reset = useStore((s) => s.reset);
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t hairline bg-abyss/92 backdrop-blur-md md:inset-y-0 md:left-0 md:right-auto md:h-auto md:w-[76px] md:flex-col md:border-r md:border-t-0"
    >
      <Link
        href="/"
        className="hidden h-[72px] items-center justify-center md:flex"
        aria-label="Adaptive RAG — home"
        title="Adaptive RAG"
      >
        <LogoMark size={30} />
      </Link>
      <ul className="flex flex-1 items-stretch justify-around md:flex-none md:flex-col md:justify-start md:gap-1 md:px-2 md:pt-2">
        {NAV.map((n) => {
          const on = path?.startsWith(n.href);
          return (
            <li key={n.href} className="flex-1 md:flex-none">
              <Link
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "group relative flex h-full flex-col items-center justify-center gap-1 rounded-[12px] py-2 transition-colors duration-150 md:h-[60px]",
                  on ? "text-foam" : "text-kelp hover:text-foam",
                )}
              >
                {on && (
                  <motion.span
                    layoutId="rail-active"
                    className="absolute inset-1 -z-0 rounded-[12px] border border-shelf bg-reef/80 md:inset-0"
                    transition={spring.fluid}
                  />
                )}
                <span className="relative grid place-items-center">
                  <Glyph name={n.glyph} size={20} className={on ? "text-foam" : undefined} />
                  {on && (
                    <motion.span
                      layoutId="rail-dot"
                      className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-sodium"
                      transition={spring.fluid}
                    />
                  )}
                </span>
                <span className="relative text-[10.5px] font-[560] tracking-[0.01em]">{n.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden flex-col items-center gap-2 pb-4 md:mt-auto md:flex">
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Reset the demo? Everything learned in this session is cleared and the starting memories come back.")) reset();
          }}
          className="flex flex-col items-center gap-1 rounded-[10px] px-2 py-2 text-kelp transition-colors hover:bg-reef hover:text-foam"
          title="Reset demo"
        >
          <RotateCcw size={16} strokeWidth={1.6} />
          <span className="text-[10px] font-[540]">Reset</span>
        </button>
      </div>
    </nav>
  );
}
