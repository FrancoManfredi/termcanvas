const FACTORY_RANGE_START = 17680;
const FACTORY_RANGE_END = 17690;
let cachedPort: number | null = null;
let cachedAt = 0;
const TTL_MS = 30000;
const FETCH_TIMEOUT_MS = 1500;

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

let pendingDiscovery: Promise<number | null> | null = null;

export async function discoverFactoryPort(): Promise<number | null> {
  if (pendingDiscovery) return pendingDiscovery;
  const promise = (async () => {
    const now = Date.now();
    if (cachedPort !== null && now - cachedAt < TTL_MS) {
      try {
        const res = await fetchWithTimeout(`http://127.0.0.1:${cachedPort}/factory/health`, 2500);
        if (res.ok) {
          cachedAt = now;
          return cachedPort;
        }
      } catch {}
      cachedPort = null;
    }
    // Only try 17680 and 17681 — factory is almost always on one of these. No spam of 17682-17690.
    for (const port of [FACTORY_RANGE_START, FACTORY_RANGE_START + 1]) {
      try {
        const res = await fetchWithTimeout(`http://127.0.0.1:${port}/factory/health`, 2500);
        if (res.ok) {
          cachedPort = port;
          cachedAt = now;
          return port;
        }
      } catch {}
    }
    return null;
  })();
  pendingDiscovery = promise;
  try {
    return await promise;
  } finally {
    pendingDiscovery = null;
  }
}

export function getCachedFactoryPort(): number | null {
  return cachedPort;
}
