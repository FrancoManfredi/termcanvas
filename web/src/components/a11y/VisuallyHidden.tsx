// SRP: a11y helper — visually hidden but accessible to screen readers
// Source: P1-05 DoD · A11y polish

import type { ReactNode } from "react";

export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return (
    <span className="absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]" style={{ clipPath: "inset(50%)", margin: -1 }}>
      {children}
    </span>
  );
}
