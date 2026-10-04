import { cx } from "@/lib/format";

/** The isoline mark: three contour loops around a summit — a memory peak. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden className={className}>
      <path
        d="M3.5 18.6c0-7.4 5.3-13.4 12.7-13.4 7 0 12.3 5.1 12.3 11.2 0 7.3-5.6 11.4-12.9 11.4-7.1 0-12.1-3.4-12.1-9.2Z"
        stroke="#1f4b51"
        strokeWidth="1.6"
      />
      <path
        d="M8.2 17.9c0-4.6 3.4-8.2 8-8.2 4.3 0 7.6 3 7.6 6.8 0 4.4-3.4 7-8 7-4.4 0-7.6-2.1-7.6-5.6Z"
        stroke="#86a9a4"
        strokeWidth="1.6"
      />
      <path d="M12.6 17.2c0-2.1 1.6-3.7 3.7-3.7 2 0 3.5 1.3 3.5 3.1 0 2-1.6 3.2-3.7 3.2-2 0-3.5-.9-3.5-2.6Z" stroke="#e6f2ee" strokeWidth="1.6" />
      <circle cx="16.3" cy="16.9" r="1.6" fill="#ff6b93" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-display text-[1.05rem] font-[720] tracking-[-0.01em]" style={{ ["--wdth" as string]: 118 }}>
        Adaptive RAG
      </span>
    </span>
  );
}
