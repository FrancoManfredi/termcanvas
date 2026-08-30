// SRP: generic section wrapper for Settings — title, description, children
// Reusable, no domain logic

import type { ReactNode } from "react";

export interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
}

export function SettingsSection({ title, description, children, id }: SettingsSectionProps) {
  return (
    <section id={id} className="rounded-[12px] border border-zinc-200 bg-white p-4">
      <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">{title}</h3>
      {description && <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
