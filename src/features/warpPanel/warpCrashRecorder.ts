/**
 * warpCrashRecorder — offline crash ring for the Warp panel.
 *
 * Purpose: catch the remaining review→awaiting render throw instead of
 * guessing it. A `window` error/unhandledrejection handler stores a small
 * ring (max 3) in localStorage under `warp-last-crash`:
 * `{ at, message, stack (trimmed to 500 chars), section }`.
 *
 * Guarantees:
 * - Never throws (every path is guarded, including storage/JSON).
 * - Never blocks (synchronous localStorage write only, no network, no
 *   rethrow, no preventDefault).
 * - No PII beyond the JS stack (no URLs, no issue titles, no user data —
 *   only the error message/stack plus the panel section).
 *
 * Pure ESM, zero React imports (offline-testable). Mounted once at the top
 * of the panel (`WarpPanelShell`) via `installWarpCrashRecorder`.
 */

export const WARP_LAST_CRASH_STORAGE_KEY = "warp-last-crash";

/** Max entries kept (ring). */
export const WARP_LAST_CRASH_CAP = 3;

/** Max chars kept from the JS stack (PII bound). */
export const WARP_STACK_MAX_CHARS = 500;

/** Max chars kept from the error message. */
export const WARP_MESSAGE_MAX_CHARS = 300;

/** Max chars kept from the panel section. */
export const WARP_SECTION_MAX_CHARS = 32;

export interface WarpCrashEntry {
  at: string;
  message: string;
  stack: string;
  section: string;
}

function safeSection(value: unknown): string {
  try {
    if (typeof value !== "string") return "unknown";
    const trimmed = value.trim();
    if (trimmed === "") return "unknown";
    return trimmed.slice(0, WARP_SECTION_MAX_CHARS);
  } catch {
    return "unknown";
  }
}

function safeMessage(value: unknown): string {
  try {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return "unknown error";
      return trimmed.slice(0, WARP_MESSAGE_MAX_CHARS);
    }
    if (value instanceof Error) {
      const msg =
        typeof value.message === "string" && value.message.trim() !== ""
          ? value.message.trim()
          : String(value).slice(0, WARP_MESSAGE_MAX_CHARS);
      return msg.slice(0, WARP_MESSAGE_MAX_CHARS);
    }
    return String(value).slice(0, WARP_MESSAGE_MAX_CHARS) || "unknown error";
  } catch {
    return "unknown error";
  }
}

function safeStack(value: unknown, fallbackMessage: string): string {
  try {
    const raw =
      value instanceof Error && typeof value.stack === "string"
        ? value.stack
        : typeof value === "string"
          ? value
          : fallbackMessage;
    return String(raw).slice(0, WARP_STACK_MAX_CHARS);
  } catch {
    return "";
  }
}

function safeNowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    try {
      return String(Date.now());
    } catch {
      return "unknown";
    }
  }
}

/**
 * Read the stored crash ring. Always returns an array (possibly empty).
 * Never throws.
 */
export function readWarpLastCrash(): WarpCrashEntry[] {
  try {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return [];
    }
    const raw = window.localStorage.getItem(WARP_LAST_CRASH_STORAGE_KEY);
    if (typeof raw !== "string" || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: WarpCrashEntry[] = [];
    for (const entry of parsed) {
      try {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          continue;
        }
        const rec = entry as Record<string, unknown>;
        out.push({
          at: typeof rec.at === "string" ? rec.at.slice(0, 64) : "unknown",
          message:
            typeof rec.message === "string"
              ? rec.message.slice(0, WARP_MESSAGE_MAX_CHARS)
              : "unknown error",
          stack:
            typeof rec.stack === "string"
              ? rec.stack.slice(0, WARP_STACK_MAX_CHARS)
              : "",
          section:
            typeof rec.section === "string"
              ? rec.section.slice(0, WARP_SECTION_MAX_CHARS)
              : "unknown",
        });
      } catch {
        // One corrupt entry never breaks the read.
      }
    }
    return out.slice(-WARP_LAST_CRASH_CAP);
  } catch {
    return [];
  }
}

/**
 * Append one crash entry to the ring (max 3, oldest dropped).
 * Never throws, never blocks (sync storage write only).
 */
export function recordWarpCrash(
  error: unknown,
  section: unknown = "unknown",
): void {
  try {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return;
    }
    const message = safeMessage(
      error instanceof Error
        ? error.message
        : (error as { message?: unknown })?.message ?? error,
    );
    const stack = safeStack(error, message);
    const entry: WarpCrashEntry = {
      at: safeNowIso(),
      message,
      stack,
      section: safeSection(section),
    };
    let ring: WarpCrashEntry[] = [];
    try {
      ring = readWarpLastCrash();
    } catch {
      ring = [];
    }
    ring.push(entry);
    const trimmed = ring.slice(-WARP_LAST_CRASH_CAP);
    try {
      window.localStorage.setItem(
        WARP_LAST_CRASH_STORAGE_KEY,
        JSON.stringify(trimmed),
      );
    } catch {
      // Storage failure (private mode, quota) never breaks the panel.
    }
  } catch {
    // Recording must never throw.
  }
}

type SectionGetter = () => string;

let currentSectionGetter: SectionGetter | null = null;
let listenersInstalled = false;
let cachedErrorHandler: ((event: ErrorEvent) => void) | null = null;
let cachedRejectionHandler: ((event: PromiseRejectionEvent) => void) | null =
  null;

function readSectionNow(): string {
  try {
    if (typeof currentSectionGetter === "function") {
      return safeSection(currentSectionGetter());
    }
  } catch {
    // A throwing getter never breaks the recorder.
  }
  return "unknown";
}

function buildErrorHandler(): (event: ErrorEvent) => void {
  return (event: ErrorEvent) => {
    try {
      const error =
        event !== null &&
        typeof event === "object" &&
        "error" in (event as unknown as Record<string, unknown>)
          ? (event as unknown as { error?: unknown }).error ?? event
          : event;
      const message =
        event !== null &&
        typeof event === "object" &&
        typeof (event as unknown as { message?: unknown }).message === "string"
          ? (event as unknown as { message: string }).message
          : error;
      void message;
      recordWarpCrash(error ?? event, readSectionNow());
    } catch {
      // Never throws, never blocks.
    }
  };
}

function buildRejectionHandler(): (event: PromiseRejectionEvent) => void {
  return (event: PromiseRejectionEvent) => {
    try {
      const reason =
        event !== null &&
        typeof event === "object" &&
        "reason" in (event as unknown as Record<string, unknown>)
          ? (event as unknown as { reason?: unknown }).reason
          : event;
      recordWarpCrash(reason ?? event, readSectionNow());
    } catch {
      // Never throws, never blocks.
    }
  };
}

/**
 * Install the window error/unhandledrejection recorder. Idempotent per
 * window: re-installs on the same window reuse the handlers (real browsers
 * dedupe identical listeners), installs on a new window object attach
 * there too; every call refreshes the section getter. Returns a cleanup
 * bound to the window captured at install time (tests/unmount).
 * Never throws.
 */
export function installWarpCrashRecorder(
  getSection?: SectionGetter,
): () => void {
  try {
    if (typeof getSection === "function") {
      currentSectionGetter = getSection;
    } else if (currentSectionGetter === null) {
      currentSectionGetter = () => "unknown";
    }
    if (
      typeof window === "undefined" ||
      typeof window.addEventListener !== "function" ||
      typeof window.removeEventListener !== "function"
    ) {
      return () => {};
    }
    const target = window;
    if (cachedErrorHandler === null) {
      cachedErrorHandler = buildErrorHandler();
    }
    if (cachedRejectionHandler === null) {
      cachedRejectionHandler = buildRejectionHandler();
    }
    const errorHandler = cachedErrorHandler;
    const rejectionHandler = cachedRejectionHandler;
    // Always attach: real browsers dedupe identical (type, handler)
    // pairs, so reinstalls are free; test fakes with a fresh `window`
    // object still receive the handlers.
    try {
      target.addEventListener("error", errorHandler as EventListener);
    } catch {
      // Listener failure never breaks the panel.
    }
    try {
      target.addEventListener(
        "unhandledrejection",
        rejectionHandler as EventListener,
      );
    } catch {
      // Listener failure never breaks the panel.
    }
    listenersInstalled = true;
    try {
      (target as unknown as Record<string, unknown>).__warpCrashRecorderInstalled =
        true;
    } catch {
      // Flag write failure is irrelevant.
    }
    return () => {
      try {
        try {
          target.removeEventListener(
            "error",
            errorHandler as EventListener,
          );
        } catch {
          // Cleanup never throws.
        }
        try {
          target.removeEventListener(
            "unhandledrejection",
            rejectionHandler as EventListener,
          );
        } catch {
          // Cleanup never throws.
        }
      } finally {
        // Only clear the shared cache when this cleanup owns it; a newer
        // install on another window keeps working.
        if (
          cachedErrorHandler === errorHandler &&
          cachedRejectionHandler === rejectionHandler
        ) {
          cachedErrorHandler = null;
          cachedRejectionHandler = null;
          listenersInstalled = false;
        }
        try {
          delete (target as unknown as Record<string, unknown>)
            .__warpCrashRecorderInstalled;
        } catch {
          // Flag cleanup failure is irrelevant.
        }
      }
    };
  } catch {
    return () => {};
  }
}
