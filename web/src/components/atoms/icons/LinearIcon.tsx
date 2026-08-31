export function LinearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#5E6AD2" />
      <path d="M4.5 15.5L15.5 4.5M4.5 15.5L8 19l11-11-3.5-3.5M4.5 15.5l3.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
