// The product's own vocabulary of marks (DESIGN_PLAN.md §2.4): 16px grid, 1.5px stroke.

import type { SVGProps } from "react";
import type { MemoryClass } from "@/lib/engine/types";

export type GlyphName =
  | MemoryClass
  | "document"
  | "conversation"
  | "memory"
  | "weights"
  | "expired"
  | "added"
  | "ping"
  | "confirm"
  | "flag"
  | "outdated"
  | "pin"
  | "profile"
  | "preference"
  | "research";

const paths: Record<GlyphName, React.ReactNode> = {
  persistent: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  profile: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  preference: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.5 8h5" />
    </>
  ),
  important: (
    <>
      <path d="M8 2.4 13.6 8 8 13.6 2.4 8Z" />
      <path d="M8 6 10 8 8 10 6 8Z" fill="currentColor" stroke="none" />
    </>
  ),
  correction: (
    <>
      <path d="M12.6 9.6A4.9 4.9 0 1 1 11.4 4.6" />
      <path d="M12.6 2.4v2.8H9.8" />
    </>
  ),
  temporary: <circle cx="8" cy="8" r="5.5" strokeDasharray="2.2 1.9" />,
  irrelevant: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M4.2 11.8 11.8 4.2" />
    </>
  ),
  document: (
    <>
      <path d="M4 2.5h5.3l2.7 2.8v8.2H4Z" />
      <path d="M9.3 2.5v2.8H12M6 8.2h4M6 10.7h3" />
    </>
  ),
  conversation: <path d="M3 4h10v6.3H7.4L4.6 12.8v-2.5H3Z" />,
  memory: (
    <>
      <path d="M2.6 8.4c0-3.1 2.3-5.2 5.6-5.2 3.1 0 5.2 2 5.2 4.6 0 3-2.4 5-5.6 5-3 0-5.2-1.6-5.2-4.4Z" />
      <path d="M6 8.2c0-1.1.9-1.9 2.1-1.9 1.1 0 1.9.7 1.9 1.7 0 1.1-.9 1.9-2.1 1.9S6 9.2 6 8.2Z" />
    </>
  ),
  weights: (
    <>
      <path d="M8 2.8v10.4M5 13.2h6M3.2 5.2h9.6" />
      <path d="M3.2 5.2 1.8 9h2.8ZM12.8 5.2 11.4 9h2.8Z" />
    </>
  ),
  expired: <path d="m4.5 4.5 7 7m0-7-7 7" />,
  research: (
    <>
      <path d="M6.2 2.2h3.6M6.8 2.2v4.1L3 12.6c-.5.8.1 1.6 1 1.6h8c.9 0 1.5-.8 1-1.6L9.2 6.3V2.2" />
      <path d="M4.6 10h6.8" />
    </>
  ),
  added: <path d="M8 3.2v9.6M3.2 8h9.6" />,
  ping: (
    <>
      <circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="5.5" />
    </>
  ),
  confirm: <path d="m3.4 8.6 2.9 2.9 6.3-6.9" />,
  flag: (
    <>
      <path d="M8 2.6 14 13H2Z" />
      <path d="M8 6.6v3M8 11.2v.1" />
    </>
  ),
  outdated: (
    <>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2.2 1.9" />
      <path d="M4.5 8h7" />
    </>
  ),
  pin: (
    <>
      <path d="M6 2.8h4l-.6 4 2.4 2.2H4.2L6.6 6.8Z" />
      <path d="M8 9v4.4" />
    </>
  ),
};

export function Glyph({ name, size = 16, className, ...rest }: { name: GlyphName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

/** Colour token per memory class / source — glyphs carry colour, text never does. */
export const CLASS_TONE: Record<string, string> = {
  persistent: "text-rhodamine",
  important: "text-rhodamine",
  correction: "text-sodium",
  temporary: "text-rhodamine",
  irrelevant: "text-kelp",
  document: "text-glacier",
  memory: "text-rhodamine",
};

export const CLASS_LABEL: Record<MemoryClass, string> = {
  persistent: "Persistent",
  important: "Important",
  correction: "Correction",
  temporary: "Temporary",
  irrelevant: "Irrelevant",
};
