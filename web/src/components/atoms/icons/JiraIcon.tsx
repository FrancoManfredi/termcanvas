export function JiraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M11.571 11.429L6 5.857A5.714 5.714 0 0111.714 11.571l5.572 5.572A5.714 5.714 0 0111.571 11.43z" fill="#2684FF" />
      <path d="M11.571 11.429L6 17A5.714 5.714 0 0011.714 11.286L17.286 5.714A5.714 5.714 0 0011.571 11.43z" fill="url(#j2)" />
      <defs>
        <linearGradient id="j2" x1="11.571" y1="11.429" x2="17.286" y2="5.714" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0052CC" />
          <stop offset="1" stopColor="#2684FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}
