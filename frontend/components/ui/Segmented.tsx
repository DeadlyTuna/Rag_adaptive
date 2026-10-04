"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cx } from "@/lib/format";
import { spring } from "@/lib/motion";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; hint?: string }[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("relative inline-flex rounded-[10px] border border-shelf bg-abyss/50 p-0.5", className)}
      onKeyDown={(e) => {
        const i = options.findIndex((o) => o.value === value);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(options[(i + 1) % options.length].value);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(options[(i - 1 + options.length) % options.length].value);
        }
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative z-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-[8px] font-[540] transition-colors duration-150",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
              on ? "text-foam" : "text-kelp hover:text-foam",
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[8px] border border-shelf bg-reef"
                transition={spring.snap}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
