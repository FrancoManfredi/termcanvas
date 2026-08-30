// SRP: presentational section — renders title + content, no store, no side effects
// DIP: depends only on props abstraction; caller (page) lista, section muestra

import type { ReactNode } from "react";

export interface HelpSectionProps {
  id: string;
  title: string;
  description?: string;
  children?: ReactNode;
}

export function HelpSection({ id, title, description, children }: HelpSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="rounded-[12px] border border-zinc-200 bg-white p-4"
    >
      <h2 id={`${id}-heading`} className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">
        {title}
      </h2>
      {description ? <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}
