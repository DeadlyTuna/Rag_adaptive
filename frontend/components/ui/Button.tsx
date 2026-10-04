import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-[560] transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:translate-y-px disabled:opacity-45 disabled:active:translate-y-0";

const variants: Record<Variant, string> = {
  primary:
    "bg-foam text-abyss hover:bg-white hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-foam)_16%,transparent)]",
  secondary: "border border-shelf bg-trench/80 text-foam hover:border-kelp/50 hover:bg-reef",
  ghost: "text-kelp hover:bg-reef/70 hover:text-foam",
  danger: "border border-flare/40 text-flare hover:bg-flare/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 rounded-[8px] px-3 text-[13px]",
  md: "h-10 rounded-[10px] px-4 text-sm",
  lg: "h-12 rounded-full px-6 text-[15px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={cx(base, variants[variant], sizes[size], className)} {...rest} />;
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <Link href={href} className={cx(base, variants[variant], sizes[size], className)} {...rest}>
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-grid h-8 w-8 place-items-center rounded-[8px] text-kelp transition-colors duration-150 hover:bg-reef hover:text-foam",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "mono inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-shelf bg-abyss/60 px-1.5 text-[10.5px] leading-none text-kelp",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
