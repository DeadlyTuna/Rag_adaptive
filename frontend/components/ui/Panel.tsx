import type { ReactNode } from "react";
import { cx } from "@/lib/format";

export function Panel({
  title,
  meta,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("panel relative flex min-w-0 flex-col", className)} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {(title || meta) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b hairline px-4 py-2.5">
          {title && (
            <h2 id={id ? `${id}-title` : undefined} className="label">
              {title}
            </h2>
          )}
          {meta && <div className="flex items-center gap-2 text-xs text-kelp">{meta}</div>}
        </header>
      )}
      <div className={cx("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("label", className)}>{children}</p>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-6">
      <p className="text-sm font-[560] text-foam">{title}</p>
      {children && <p className="max-w-sm text-[13px] text-kelp">{children}</p>}
      {action}
    </div>
  );
}
