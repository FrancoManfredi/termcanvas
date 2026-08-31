import * as React from "react";

export function AgentTypeIcon({ type, size = "md" }: { type: string; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? 48 : size === "sm" ? 28 : 36;
  const s = size === "lg" ? 22 : size === "sm" ? 14 : 18;

  const configs: Record<string, { bg: string; children: React.ReactElement }> = {
    foreman: {
      bg: "#ede9fe",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <rect x="2" y="6" width="16" height="11" rx="3" stroke="#7c3aed" strokeWidth="1.5" />
          <path d="M6 6V5a4 4 0 018 0v1" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="12" r="1" fill="#7c3aed" />
          <circle cx="13" cy="12" r="1" fill="#7c3aed" />
          <path d="M8.5 15h3" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M10 6v2M7 6l-1.5-1.5M13 6l1.5-1.5" stroke="#7c3aed" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    },
    triage: {
      bg: "#f3f4f6",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="#9ca3af" strokeWidth="1.4" strokeDasharray="3.5 2" />
          <path d="M10 6.5v3.5l2.5 1.5" stroke="#6b7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    spec: {
      bg: "#fff7ed",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M4 4c0-1.1.9-2 2-2h5l5 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" stroke="#f97316" strokeWidth="1.4" />
          <path d="M11 2v5h5" stroke="#f97316" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M7 10h6M7 13h4" stroke="#f97316" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
    },
    implement: {
      bg: "#eff6ff",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M7 7L4 10l3 3M13 7l3 3-3 3M11.5 5l-3 10" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    review: {
      bg: "#fdf2f8",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H7l-4 2V5z" stroke="#ec4899" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M7 8h6M7 11h4" stroke="#ec4899" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
    },
    custom: {
      bg: "#f0fdf4",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="#22c55e" strokeWidth="1.4" />
          <path d="M10 7v6M7 10h6" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
    },
  };

  const cfg = configs[type] ?? configs.custom;
  return (
    <div className="rounded-lg flex items-center justify-center flex-shrink-0" style={{ width: dim, height: dim, backgroundColor: cfg.bg }}>
      {cfg.children}
    </div>
  );
}
