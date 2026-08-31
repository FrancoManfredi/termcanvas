export function SlackIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#4A154B" />
      <path d="M8.5 13.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm0 0V8M15.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 0v5.5M10.5 8.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 0H16M13.5 15.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm0 0H8" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
