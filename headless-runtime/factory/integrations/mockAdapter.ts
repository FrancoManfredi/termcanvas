/**
 * integrations/mockAdapter — Wave 14 T03 (Track B): local mock adapter (P0).
 *
 * The ONLY P0 implementation of the `IntegrationAdapter` port declared in
 * `./integrationTypes.ts` (single vocabulary, C6). Local disk only:
 * `factory/.integrations-mock.json` ring with cap `INTEGRATION_MOCK_MAX`.
 * Zero network, zero tokens, zero SDK, zero `fetch` (there is no import of
 * any network module in this file; the suite asserts `fetch` is never
 * called). ESM only, zero `require()`.
 *
 * Contracts (mirror `headless-runtime/notify/notifications.ts` on purpose):
 * - Single writer (C3): this module is the only writer of
 *   `.integrations-mock.json` (atomic tmp-to-rename write, best-effort).
 * - Tolerant restore: missing or corrupt file equals an empty list, never a
 *   throw toward callers (routes stay fail-safe, C2).
 * - Ring: oldest evicted first when the cap is exceeded (bounded, LOOPS I02).
 * - Ids: `m-<epochMs>-<counter>` (counter kept unique per process, restored
 *   past the maximum seen id after a reload).
 * - `post` validates with `MockPostInputSchema` and THROWS on invalid input
 *   (programmer error: `integrationService` always validates first, so routes
 *   never reach this throw). `ack`/`list` never throw (false/empty instead).
 * - Test seam: `TERMCANVAS_FACTORY_DIR` points the file at a sandbox dir;
 *   `resetMockAdapterForTests` clears memory plus the sandbox file.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  INTEGRATION_MOCK_MAX,
  MockPostInputSchema,
} from "./integrationTypes";
import type {
  IntegrationAdapter,
  IntegrationsMockFileShape,
  MockPostRecord,
} from "./integrationTypes";

/** Validated post input (inferred from the T01 schema, never redefined). */
export type MockPostInput = z.infer<typeof MockPostInputSchema>;

/** Evidence file name under the factory base dir. */
export const INTEGRATIONS_MOCK_FILE_NAME = ".integrations-mock.json";

/** Store order: oldest first, newest last (ring, oldest evicted first). */
let posts: MockPostRecord[] = [];
let counter = 0;
/** Path `posts` was loaded from (null means not loaded for the current path). */
let loadedPath: string | null = null;

function getRepoRoot(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(currentFile), "../../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {
    // falls through to cwd
  }
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "headless-runtime"))
    ) {
      return cwd;
    }
  } catch {
    // falls through to cwd directly
  }
  return process.cwd();
}

function getFactoryBaseDir(): string {
  try {
    const env = process.env.TERMCANVAS_FACTORY_DIR;
    if (typeof env === "string" && env.trim().length > 0) {
      return path.resolve(env.trim());
    }
  } catch {
    // falls through to repo
  }
  try {
    return path.join(getRepoRoot(), "factory");
  } catch {
    return path.join(process.cwd(), "factory");
  }
}

/** Absolute path of the mock evidence file. Never throws. */
export function getIntegrationsMockFilePath(): string {
  try {
    return path.join(getFactoryBaseDir(), INTEGRATIONS_MOCK_FILE_NAME);
  } catch {
    return path.join(process.cwd(), "factory", INTEGRATIONS_MOCK_FILE_NAME);
  }
}

function isValidRecord(value: unknown): value is MockPostRecord {
  try {
    if (!value || typeof value !== "object") return false;
    const r = value as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id.trim().length === 0) return false;
    if (r.provider !== "linear") return false;
    if (r.kind !== "issue" && r.kind !== "notification") return false;
    if (typeof r.title !== "string" || r.title.length === 0) return false;
    if (typeof r.body !== "string") return false;
    if (typeof r.at !== "string" || r.at.length === 0) return false;
    if (typeof r.acked !== "boolean") return false;
    if (r.ackAt !== null && typeof r.ackAt !== "string") return false;
    return true;
  } catch {
    return false;
  }
}

function copyPost(p: MockPostRecord): MockPostRecord {
  try {
    return {
      id: p.id,
      provider: "linear",
      kind: p.kind,
      jobId: typeof p.jobId === "string" ? p.jobId : null,
      title: p.title,
      body: p.body,
      at: p.at,
      acked: p.acked === true,
      ackAt: typeof p.ackAt === "string" ? p.ackAt : null,
    };
  } catch {
    return { ...p };
  }
}

/** Loads the file into memory (tolerant: missing/corrupt means empty). */
function ensureLoaded(): void {
  try {
    const current = getIntegrationsMockFilePath();
    if (loadedPath === current) return;
    let next: MockPostRecord[] = [];
    try {
      if (!fs.existsSync(current)) {
        posts = [];
        loadedPath = current;
        return;
      }
      const raw = fs.readFileSync(current, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      const arr =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Partial<IntegrationsMockFileShape>).posts
          : null;
      if (!Array.isArray(arr)) {
        posts = [];
        loadedPath = current;
        return;
      }
      arr.forEach((item) => {
        try {
          if (isValidRecord(item)) next.push(copyPost(item));
        } catch {
          // broken entry: skipped
        }
      });
      // Hard cap against a hand-edited oversized file: keep the newest.
      if (next.length > INTEGRATION_MOCK_MAX) {
        next = next.slice(-INTEGRATION_MOCK_MAX);
      }
      posts = next;
      // Keep the counter past the maximum seen id (no collisions within
      // the same millisecond after a reload).
      try {
        let maxSeen = counter;
        posts.forEach((p) => {
          try {
            const m = /^m-\d+-(\d+)$/.exec(p.id);
            if (m && m[1]) {
              const n = Number(m[1]);
              if (Number.isInteger(n) && n > maxSeen) maxSeen = n;
            }
          } catch {
            // id shape ignored
          }
        });
        counter = maxSeen;
      } catch {
        // noop
      }
      loadedPath = current;
    } catch {
      posts = [];
      try {
        loadedPath = current;
      } catch {
        // noop
      }
    }
  } catch {
    // never throws
  }
}

function persistBestEffort(): void {
  try {
    const target = getIntegrationsMockFilePath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    } catch {
      // noop
    }
    const shape: IntegrationsMockFileShape = {
      version: 1,
      posts: posts.map((p) => copyPost(p)),
    };
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(shape, null, 2), "utf-8");
    } catch {
      return;
    }
    try {
      fs.renameSync(tmp, target);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // noop
      }
      return;
    }
    try {
      loadedPath = target;
    } catch {
      // noop
    }
  } catch {
    // best-effort: persisting never breaks the flow
  }
}

/**
 * Records one mock post. Throws on schema-invalid input (programmer error:
 * `integrationService.postNotification` validates first, so HTTP routes
 * never reach this throw). Never touches the network.
 */
export function postMockPost(input: MockPostInput): MockPostRecord {
  const parsed = MockPostInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where =
      first && first.path.length > 0 ? ` at "${String(first.path.join("."))}"` : "";
    throw new Error(
      `invalid mock post input${where} (${String(first?.message ?? parsed.error.message).slice(0, 160)})`,
    );
  }
  try {
    ensureLoaded();
  } catch {
    // memory store still counts
  }
  counter += 1;
  const record: MockPostRecord = {
    id: `m-${Date.now()}-${counter}`,
    provider: "linear",
    kind: parsed.data.kind,
    jobId: parsed.data.jobId,
    title: parsed.data.title,
    body: parsed.data.body,
    at: new Date().toISOString(),
    acked: false,
    ackAt: null,
  };
  posts.push(record);
  // Ring (LOOPS I02): oldest evicted first; every pass shrinks the list.
  try {
    while (posts.length > INTEGRATION_MOCK_MAX) posts.splice(0, 1);
  } catch {
    // memory push already counts
  }
  try {
    persistBestEffort();
  } catch {
    // best-effort
  }
  return copyPost(record);
}

/**
 * Marks one mock post acked. Unknown id returns false. Never throws.
 */
export function ackMockPost(id: unknown): boolean {
  try {
    try {
      ensureLoaded();
    } catch {
      // follows with memory
    }
    if (typeof id !== "string" || id.trim().length === 0) return false;
    const key = id.trim();
    const found = posts.find((p) => p?.id === key) ?? null;
    if (!found) return false;
    try {
      found.acked = true;
      found.ackAt = new Date().toISOString();
    } catch {
      return false;
    }
    try {
      persistBestEffort();
    } catch {
      // best-effort: the in-memory ack already counts
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Latest mock posts, newest first, cap `limit ?? INTEGRATION_MOCK_MAX`
 * (larger limits clamp to the max). Never throws.
 */
export function listMockPosts(limit?: unknown): MockPostRecord[] {
  try {
    try {
      ensureLoaded();
    } catch {
      // follows with memory
    }
    let cap = INTEGRATION_MOCK_MAX;
    try {
      if (limit === undefined || limit === null) {
        cap = INTEGRATION_MOCK_MAX;
      } else if (typeof limit !== "number" || !Number.isFinite(limit)) {
        cap = INTEGRATION_MOCK_MAX;
      } else {
        const floored = Math.floor(limit);
        if (floored <= 0) return [];
        cap = Math.min(floored, INTEGRATION_MOCK_MAX);
      }
    } catch {
      cap = INTEGRATION_MOCK_MAX;
    }
    const out: MockPostRecord[] = [];
    try {
      posts
        .slice()
        .reverse()
        .forEach((p) => {
          try {
            if (out.length < cap) out.push(copyPost(p));
          } catch {
            // partial best-effort
          }
        });
    } catch {
      // partial best-effort
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Clears memory (plus the sandbox `.integrations-mock.json` best-effort)
 * and restarts the counter. Tests only. Never throws.
 */
export function resetMockAdapterForTests(): void {
  try {
    posts = [];
  } catch {
    // noop
  }
  try {
    counter = 0;
  } catch {
    // noop
  }
  try {
    const target = getIntegrationsMockFilePath();
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // noop
    }
  } catch {
    // noop
  }
  try {
    loadedPath = null;
  } catch {
    // noop
  }
}

/**
 * P0 port implementation (the future P1 live adapter implements this same
 * interface, so callers never change). Zero network by construction.
 */
export const mockAdapter: IntegrationAdapter = {
  post: (input) => postMockPost(input),
  ack: (id) => ackMockPost(id),
  list: (limit) => listMockPosts(limit),
};
