export function StageIcon({ stage, size = 16 }: { stage: string; size?: number }) {
  if (stage === "triage") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="8" cy="8" r="5.5" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="3 1.8" />
        <path d="M8 5.5V8l1.5 1" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (stage === "planning") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <path d="M3 3c0-.6.4-1 1-1h4l4 4v6a1 1 0 01-1 1H4a1 1 0 01-1-1V3z" stroke="#f97316" strokeWidth="1.5" />
        <path d="M8 2v4h4" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (stage === "building") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <path d="M5 6L3 8l2 2M11 6l2 2-2 2M9 4l-2 8" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (stage === "reviewing") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <path d="M2 4a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0114 4v6a1.5 1.5 0 01-1.5 1.5H6l-3 1.5V4z" stroke="#ec4899" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}
