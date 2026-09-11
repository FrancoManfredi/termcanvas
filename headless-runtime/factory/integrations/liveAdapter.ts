/**
 * integrations/liveAdapter — F1 live seam: live port implementation.
 *
 * Thin HTTPS port over the SAME `IntegrationAdapter` shape the mock uses
 * (plus `postBack`), with the credential discipline that makes live traffic
 * safe: the secret is resolved from the environment AT CALL TIME via
 * `vault.readRef(vaultRef)`, is held only in a local header variable, and
 * EVERY log line goes through `vault.redact()` first — zero secrets on disk,
 * in yaml, or in logs. Effects are bounded by LOOPS L-IN-02
 * (`POSTBACK_MAX_ATTEMPTS = 3`: 1 try + 2 retries, then an honest failure —
 * no timers, no backoff sleeps, no new intervals).
 *
 * Notes on shape:
 * - The network is inherently async, so this adapter is async while the
 *   mock stays sync; `integrationService` awaits it and stays total (never
 *   throws toward routes). `post` keeps throw-on-invalid-input parity with
 *   `mockAdapter.post` (programmer error); everything else degrades
 *   honestly (`ack` false, `list` empty, `postBack` ok:false).
 * - `fetch` is INJECTED (`fetchImpl`, defaulting to `globalThis.fetch`) so
 *   suites run 100% offline with zero real network.
 * - Every attempt carries an EXPLICIT timeout (`timeoutMs`, default 15s).
 *
 * ESM only, zero `require()`. `postBack` never throws; `post` throws only
 * on invalid input or unreachable live (same contract as the mock).
 */

import {
  MockPostInputSchema,
  POSTBACK_MAX_ATTEMPTS,
  PostBackSchema,
} from "./integrationTypes";
import type { MockPostRecord } from "./integrationTypes";
import { readRef, redact } from "./vault";

/** Minimal fetch surface the adapter needs (global fetch satisfies it). */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** Injected fetch (tests pass a mock; production passes global fetch). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: unknown;
  },
) => Promise<FetchResponseLike>;

/** Default fetch: the real global fetch behind the minimal surface. */
export function defaultFetchImpl(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: unknown;
  },
): Promise<FetchResponseLike> {
  try {
    return (globalThis.fetch as unknown as FetchLike)(url, init);
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Explicit per-attempt HTTP timeout (no call without one). */
export const LIVE_ADAPTER_DEFAULT_TIMEOUT_MS = 15000;

/** Default live base URL (overridable per adapter; never a secret). */
export const LIVE_ADAPTER_DEFAULT_BASE_URL = "https://api.linear.app/v1";

/** Options for one live adapter instance (all optional, all defaulted). */
export interface LiveAdapterOptions {
  /** Provider base URL (default linear v1; tests inject a fake). */
  readonly baseUrl?: string;
  /** Env NAME holding the API key (never the key itself). */
  readonly vaultRef?: string;
  /** Env NAME holding the webhook secret (log-scrub only). */
  readonly webhookSecretRef?: string;
  /** Injected fetch (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Explicit per-attempt timeout in ms (default 15s). */
  readonly timeoutMs?: number;
  /** Log sink (every line pre-scrubbed with redact(); default silent). */
  readonly logger?: (line: string) => void;
}

/** Per-call overrides (timeout only; identity stays on the instance). */
export interface LiveCallOptions {
  readonly timeoutMs?: number;
}

/** Post-back outcome (always resolved, never thrown). */
export interface PostBackResult {
  readonly ok: boolean;
  readonly remoteId: string | null;
  readonly note: string;
  readonly attempts: number;
}

/** Async live port: same operations as the mock, plus post-back. */
export interface LiveAdapter {
  post(input: unknown, opts?: LiveCallOptions): Promise<MockPostRecord>;
  ack(id: unknown, opts?: LiveCallOptions): Promise<boolean>;
  list(limit?: unknown): Promise<MockPostRecord[]>;
  postBack(input: unknown, opts?: LiveCallOptions): Promise<PostBackResult>;
}

function resolveTimeoutMs(
  opts: LiveAdapterOptions | undefined,
  call: LiveCallOptions | undefined,
): number {
  try {
    const raw = call?.timeoutMs ?? opts?.timeoutMs ?? LIVE_ADAPTER_DEFAULT_TIMEOUT_MS;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.min(Math.floor(raw), 120000);
    }
    return LIVE_ADAPTER_DEFAULT_TIMEOUT_MS;
  } catch {
    return LIVE_ADAPTER_DEFAULT_TIMEOUT_MS;
  }
}

function resolveBaseUrl(opts: LiveAdapterOptions | undefined): string {
  try {
    const raw = opts?.baseUrl;
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim().replace(/\/+$/, "");
    return LIVE_ADAPTER_DEFAULT_BASE_URL;
  } catch {
    return LIVE_ADAPTER_DEFAULT_BASE_URL;
  }
}

function scrubRefs(opts: LiveAdapterOptions | undefined): string[] {
  try {
    const out: string[] = [];
    if (typeof opts?.vaultRef === "string" && opts.vaultRef.trim().length > 0) {
      out.push(opts.vaultRef.trim());
    }
    if (typeof opts?.webhookSecretRef === "string" && opts.webhookSecretRef.trim().length > 0) {
      out.push(opts.webhookSecretRef.trim());
    }
    return out;
  } catch {
    return [];
  }
}

function emitLog(opts: LiveAdapterOptions | undefined, line: string): void {
  try {
    if (!opts || typeof opts.logger !== "function") return;
    let scrubbed = line;
    try {
      scrubbed = redact(line, scrubRefs(opts));
    } catch {
      scrubbed = line;
    }
    try {
      opts.logger(scrubbed);
    } catch {
      // a logging sink never breaks the adapter
    }
  } catch {
    // logging never throws
  }
}

/**
 * One HTTP POST with an explicit timeout. Resolves null on ANY failure
 * (timeout, abort, network error, bad shape) — callers count the attempt
 * and move on. Never throws. Never logs the secret (callers scrub).
 */
async function postOnce(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; text: string } | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  try {
    try {
      controller = new AbortController();
    } catch {
      controller = null;
    }
    const signal = (() => {
      try {
        return controller ? controller.signal : undefined;
      } catch {
        return undefined;
      }
    })();
    const startedAt = Date.now();
    const pending = (async () => {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers,
          body,
          ...(signal !== undefined ? { signal } : {}),
        });
        let text = "";
        try {
          text = typeof res.text === "function" ? await res.text() : "";
        } catch {
          text = "";
        }
        const status = typeof res.status === "number" ? res.status : 0;
        return { status, ok: res.ok === true && status >= 200 && status < 300, text };
      } catch {
        return null;
      }
    })();
    const bounded = await Promise.race([
      pending,
      (async () => {
        try {
          await new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              try {
                controller?.abort();
              } catch {
                // abort is best-effort
              }
              resolve();
            }, timeoutMs);
          });
        } catch {
          // timer failure degrades to the pending fetch alone
        }
        return null;
      })(),
    ]);
    void startedAt;
    return bounded;
  } catch {
    return null;
  } finally {
    try {
      if (timer !== null) clearTimeout(timer);
    } catch {
      // noop
    }
  }
}

/** Best-effort remote id out of a response body (id | remoteId | key). */
function pickRemoteId(text: unknown): string | null {
  try {
    if (typeof text !== "string" || text.length === 0) return null;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    for (const key of ["id", "remoteId", "key", "ts"]) {
      try {
        const v = rec[key];
        if (typeof v === "string" && v.trim().length > 0) return v.trim().slice(0, 128);
      } catch {
        // next key
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Builds one live adapter. The secret is NEVER stored on the instance —
 * `vaultRef` (an env NAME) is stored, the value is resolved per call.
 * Never throws (a broken option set yields an adapter whose calls fail
 * honestly instead).
 */
export function createLiveAdapter(opts?: LiveAdapterOptions): LiveAdapter {
  const baseUrl = resolveBaseUrl(opts);
  const vaultRef =
    typeof opts?.vaultRef === "string" ? opts.vaultRef.trim() : "";
  const fetchImpl: FetchLike =
    typeof opts?.fetchImpl === "function" ? opts.fetchImpl : defaultFetchImpl;

  async function postBack(
    input: unknown,
    call?: LiveCallOptions,
  ): Promise<PostBackResult> {
    try {
      const parsed = PostBackSchema.safeParse(input);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return {
          ok: false,
          remoteId: null,
          note: `invalid post-back (${String(first?.message ?? "schema").slice(0, 120)})`,
          attempts: 0,
        };
      }
      const timeoutMs = resolveTimeoutMs(opts, call);
      const token = vaultRef.length > 0 ? readRef(vaultRef) : null;
      if (token === null) {
        emitLog(opts, `live post-back refused: no live credentials (vaultRef unset)`);
        return {
          ok: false,
          remoteId: null,
          note: "no live credentials (vaultRef unset or empty env): post-back refused without network",
          attempts: 0,
        };
      }
      const url = `${baseUrl}/post-back`;
      const payload = JSON.stringify({
        threadId: parsed.data.threadId,
        kind: parsed.data.kind,
        title: parsed.data.title,
        body: parsed.data.body,
        jobId: parsed.data.jobId,
      });
      let attempts = 0;
      let lastStatus = 0;
      for (let i = 0; i < POSTBACK_MAX_ATTEMPTS; i += 1) {
        attempts += 1;
        emitLog(
          opts,
          `live post-back attempt ${attempts}/${POSTBACK_MAX_ATTEMPTS} kind=${parsed.data.kind} thread=${parsed.data.threadId}`,
        );
        let res: { status: number; ok: boolean; text: string } | null = null;
        try {
          res = await postOnce(
            fetchImpl,
            url,
            {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            payload,
            timeoutMs,
          );
        } catch {
          res = null;
        }
        if (res !== null) lastStatus = res.status;
        if (res !== null && res.ok) {
          const remoteId = pickRemoteId(res.text);
          emitLog(
            opts,
            `live post-back done kind=${parsed.data.kind} thread=${parsed.data.threadId} remote=${remoteId ?? "n/a"}`,
          );
          return {
            ok: true,
            remoteId,
            note: `posted to ${parsed.data.threadId} (attempt ${attempts})`,
            attempts,
          };
        }
        emitLog(
          opts,
          `live post-back attempt ${attempts} failed (status=${lastStatus || "network"})`,
        );
      }
      return {
        ok: false,
        remoteId: null,
        note: `post-back failed after ${attempts} attempts (status=${lastStatus || "network"}): honest failed event`,
        attempts,
      };
    } catch (e) {
      return {
        ok: false,
        remoteId: null,
        note: `post-back failed (${(e instanceof Error ? e.message : String(e)).slice(0, 120)})`,
        attempts: POSTBACK_MAX_ATTEMPTS,
      };
    }
  }

  async function post(
    input: unknown,
    call?: LiveCallOptions,
  ): Promise<MockPostRecord> {
    const parsed = MockPostInputSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where =
        first && first.path.length > 0 ? ` at "${String(first.path.join("."))}"` : "";
      throw new Error(
        `invalid live post input${where} (${String(first?.message ?? parsed.error.message).slice(0, 160)})`,
      );
    }
    const timeoutMs = resolveTimeoutMs(opts, call);
    const token = vaultRef.length > 0 ? readRef(vaultRef) : null;
    if (token === null) {
      emitLog(opts, `live post refused: no live credentials (vaultRef unset)`);
      throw new Error("no live credentials (vaultRef unset or empty env): live post refused without network");
    }
    const url = `${baseUrl}/post`;
    const res = await postOnce(
      fetchImpl,
      url,
      { "content-type": "application/json", authorization: `Bearer ${token}` },
      JSON.stringify({
        provider: parsed.data.provider,
        kind: parsed.data.kind,
        jobId: parsed.data.jobId,
        title: parsed.data.title,
        body: parsed.data.body,
      }),
      timeoutMs,
    );
    if (res === null || !res.ok) {
      emitLog(opts, `live post failed (status=${res?.status ?? "network"})`);
      throw new Error(
        `live post failed (status=${res?.status ?? "network"}): honest error, no local record invented`,
      );
    }
    const remoteId = pickRemoteId(res.text);
    emitLog(opts, `live post done remote=${remoteId ?? "n/a"}`);
    return {
      id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      provider: "linear",
      kind: parsed.data.kind,
      jobId: parsed.data.jobId,
      title: parsed.data.title,
      body: parsed.data.body,
      at: new Date().toISOString(),
      acked: false,
      ackAt: null,
    };
  }

  async function ack(id: unknown): Promise<boolean> {
    try {
      if (typeof id !== "string" || id.trim().length === 0) return false;
      const timeoutMs = resolveTimeoutMs(opts, undefined);
      const token = vaultRef.length > 0 ? readRef(vaultRef) : null;
      if (token === null) {
        emitLog(opts, `live ack refused: no live credentials (vaultRef unset)`);
        return false;
      }
      const res = await postOnce(
        fetchImpl,
        `${baseUrl}/ack`,
        { "content-type": "application/json", authorization: `Bearer ${token}` },
        JSON.stringify({ id: id.trim() }),
        timeoutMs,
      );
      const done = res !== null && res.ok;
      emitLog(opts, `live ack id=${id.trim()} => ${done}`);
      return done;
    } catch {
      return false;
    }
  }

  async function list(): Promise<MockPostRecord[]> {
    // Honest scope cut (F1): provider-side listing is out of scope;
    // reconcile flows use ack + post-back only. Never throws.
    try {
      emitLog(opts, `live list: provider listing out of F1 scope (empty)`);
      return [];
    } catch {
      return [];
    }
  }

  return { post, ack, list, postBack };
}
