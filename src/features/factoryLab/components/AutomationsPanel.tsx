/**
 * AutomationsPanel — Wave 14 T04 (Track B, presentational).
 *
 * Read-only card for the automations domain (triggers without risk).
 * Contract consumed (Track A domain, read-only here):
 * `GET /factory/automations` / `POST /factory/automations/tick`.
 *
 * - Presentational only: network goes through the single renderer client
 *   (`listFactoryAutomations` + `postFactoryAutomationsTick`, which never
 *   throw); parsing is tolerant (unknown shapes render as "no data").
 * - ZERO new polling: data loads on mount plus a manual Refresh button and
 *   a manual Tick-now button (one bounded manual tick). Live job links
 *   (`#job-<id>`) reuse the existing 2.5s jobs poll data shown elsewhere.
 * - Read-only config: the panel never edits triggers (hint "edit
 *   factory.yaml"); each trigger honors its own `enabled` + `maxFires`.
 * - Fail-safe visible: daemon unreachable renders a gray notice, never a
 *   broken page.
 *
 * ESM only, zero `require()`.
 */

import { useCallback, useEffect, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  listFactoryAutomations,
  postFactoryAutomationsTick,
} from "@/lib/factoryClient";

interface AutomationRow {
  name: string;
  kind: string;
  enabled: boolean | null;
  maxFires: number | null;
  fires: number | null;
  lastResult: string | null;
  jobId: string | null;
  nextTickAt: string | null;
}

function asText(value: unknown): string | null {
  try {
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function asCount(value: unknown): number | null {
  try {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function parseTrigger(value: unknown): AutomationRow | null {
  try {
    if (!value || typeof value !== "object") return null;
    const r = value as Record<string, unknown>;
    const name = typeof r.name === "string" && r.name.trim().length > 0 ? r.name : null;
    if (name === null) return null;
    return {
      name,
      kind: asText(r.kind) ?? "?",
      enabled: r.enabled === true ? true : r.enabled === false ? false : null,
      maxFires: asCount(r.maxFires),
      fires: asCount(r.fires) ?? asCount(r.fireCount),
      lastResult: asText(r.lastResult) ?? asText(r.result),
      jobId: asText(r.jobId) ?? asText(r.lastJobId),
      nextTickAt: asText(r.nextTickAt),
    };
  } catch {
    return null;
  }
}

export function AutomationsPanel(): React.JSX.Element {
  const [rows, setRows] = useState<AutomationRow[]>([]);
  const [globalEnabled, setGlobalEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [acting, setActing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setError("factory unavailable");
        setRows([]);
        setGlobalEnabled(null);
        return;
      }
      const res = await listFactoryAutomations({ port });
      if (!res.ok) {
        setError(res.error || "factory unavailable");
        setRows([]);
        setGlobalEnabled(null);
        return;
      }
      const parsed: AutomationRow[] = [];
      try {
        for (const item of res.data.triggers) {
          const row = parseTrigger(item);
          if (row) parsed.push(row);
        }
      } catch {
        // tolerant: partial rows still render
      }
      setRows(parsed);
      setGlobalEnabled(res.data.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleTick = useCallback(async () => {
    setActing(true);
    setNotice(null);
    setError(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setError("factory unavailable");
        return;
      }
      const res = await postFactoryAutomationsTick({ port });
      if (!res.ok) {
        setError(res.error || "tick failed");
        return;
      }
      setNotice("tick requested (one bounded pass)");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }, [refresh]);

  return (
    <section
      aria-label="Automations"
      className="rounded-lg border border-zinc-200 bg-white p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold text-zinc-800">Automations</h2>
        <span
          role="status"
          aria-live="polite"
          title="Global kill-switch from factory.yaml (automations.enabled)"
          className={`inline-flex items-center rounded-md border px-2 py-px font-mono text-[11px] font-medium ${
            globalEnabled === false
              ? "border-zinc-200 bg-zinc-100 text-zinc-500"
              : globalEnabled === true
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-zinc-200 bg-zinc-100 text-zinc-500"
          }`}
        >
          {globalEnabled === false
            ? "automations off"
            : globalEnabled === true
              ? "automations on"
              : "automations ?"}
        </span>
        <span className="text-[11px] text-zinc-400">config lives in factory.yaml</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void handleTick()}
          disabled={acting || loading}
          title="Run one bounded manual tick (at most one action per trigger)"
          className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
        >
          {acting ? "Ticking…" : "Tick now"}
        </button>
      </div>

      {loading ? (
        <p className="text-[11px] text-zinc-500" aria-live="polite">
          Loading automations…
        </p>
      ) : null}
      {!loading && error ? (
        <p className="text-[11px] text-zinc-500" aria-live="polite" title={error}>
          No automation data (daemon unreachable). {error}
        </p>
      ) : null}
      {!loading && !error && notice ? (
        <p className="text-[11px] text-green-700" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="text-[11px] text-zinc-500" aria-live="polite">
          No triggers configured (edit factory.yaml to add some).
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <li key={row.name} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-900" title={row.name}>
                  {row.name}
                </span>
                <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-50 px-1.5 py-px font-mono text-[10px] text-zinc-600">
                  {row.kind}
                </span>
                <span
                  className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium ${
                    row.enabled === false
                      ? "bg-zinc-100 text-zinc-500"
                      : "bg-green-50 text-green-800"
                  }`}
                >
                  {row.enabled === false ? "off" : "on"}
                </span>
                <span className="font-mono text-[10px] text-zinc-500" title="fires / maxFires">
                  {row.fires !== null ? row.fires : "—"}/{row.maxFires !== null ? row.maxFires : "—"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                {row.lastResult ? <span>last: {row.lastResult}</span> : null}
                {row.nextTickAt ? <span>next: {row.nextTickAt}</span> : null}
                {row.jobId ? (
                  <a
                    href={`#job-${encodeURIComponent(row.jobId)}`}
                    title={`See job ${row.jobId}`}
                    className="font-mono text-zinc-500 underline decoration-dotted hover:text-zinc-700"
                  >
                    job {row.jobId}
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default AutomationsPanel;
