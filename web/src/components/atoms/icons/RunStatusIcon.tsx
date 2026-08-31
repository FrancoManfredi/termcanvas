export function RunStatusIcon({ status }: { status: string }) {
  if (status === "done") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="8" cy="8" r="6" stroke="#22c55e" strokeWidth="1.5" />
        <path d="M5 8l2 2 4-4" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "benchmark") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <path d="M8 2l1 4.5H14L10 9l1.5 4.5L8 11l-3.5 2.5L6 9 2 6.5h5L8 2z" fill="#f59e0b" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <path d="M8 2L14.9 14H1.1L8 2z" stroke="#ef4444" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 7v3M8 11.5v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="5.5" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M8 5v3l2 1" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
