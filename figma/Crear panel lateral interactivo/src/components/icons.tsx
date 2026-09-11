// Minimal SVG icon set — no emoji, no unicode glyphs

export function IconIssue({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.4"/>
      <circle cx="8" cy="8" r="2" fill={color}/>
    </svg>
  );
}

export function IconActivity({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <polyline points="1,8 4,5 6,11 9,3 11,8 13,6 15,8" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconAgents({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="12" height="8" rx="2" stroke={color} strokeWidth="1.3"/>
      <path d="M5 5V4a3 3 0 0 1 6 0v1" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="6" cy="9" r="1" fill={color}/>
      <circle cx="10" cy="9" r="1" fill={color}/>
      <path d="M6 12h4" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

export function IconContext({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke={color} strokeWidth="1.3"/>
      <path d="M5 6h6M5 9h4" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

export function IconDiagnostic({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1l1.8 5.5H15l-4.6 3.4 1.8 5.5L8 12l-4.2 3.4 1.8-5.5L1 6.5h5.2z" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconBranch({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="3.5" r="1.5" fill={color}/>
      <circle cx="4" cy="12.5" r="1.5" fill={color}/>
      <circle cx="12" cy="6" r="1.5" fill={color}/>
      <path d="M4 5v5M4 5c0 3 8 3 8 0" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconChevronDown({ size = 10, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2 3.5L5 6.5L8 3.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconChevronLeft({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M9 3L5 7L9 11" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconClose({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3l8 8M11 3l-8 8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function IconRefresh({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8a5 5 0 1 0 1-3L2 3v4h4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconGitHub({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/>
    </svg>
  );
}

export function IconAgent({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1" stroke={color} strokeWidth="1.3"/>
      <rect x="9" y="1" width="6" height="6" rx="1" stroke={color} strokeWidth="1.3"/>
      <rect x="1" y="9" width="6" height="6" rx="1" stroke={color} strokeWidth="1.3"/>
      <path d="M12 9v4M10 11h4" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

export function IconPlay({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 2.5l6 3.5-6 3.5z" fill={color}/>
    </svg>
  );
}

export function IconMerge({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" fill={color}/>
      <circle cx="4" cy="13" r="1.5" fill={color}/>
      <circle cx="12" cy="5" r="1.5" fill={color}/>
      <path d="M4 4.5v7M4 4.5C4 8 12 7 12 6.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconSession({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke={color} strokeWidth="1.3"/>
      <path d="M5 7l2 2 4-3" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconFix({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 2L7 6H3l3.5 3-1.5 5L9 11.5 13 14l-1.5-5L15 6h-4z" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  );
}
