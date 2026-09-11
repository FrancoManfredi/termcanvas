/**
 * IntegrationsPanel — Wave 14 T04 (Track B, presentational).
 *
 * Read-only card for the P0 mock-local integration (linear, no secrets).
 * Contract consumed (Track B domain, read-only here):
 * `GET /factory/integrations/status` / `POST /factory/integrations/test-post`
 * plus the existing notification ack path (`POST /:id/ack`, reused as-is).
 *
 * - Presentational only: network goes through the single renderer client
 *   (which never throws); parsing is tolerant (unknown shapes render as
 *   "no data").
 * - ZERO new polling: data loads on mount plus a manual Refresh button.
 *   The badge is amber for `mock-local` evidence and green when the `live:`
 *   section opts in (`liveMode:true`); filter + post-back states ride the
 *   same status payload (no extra request).
 * - `Send test post` writes to the local mock only (never to a real
 *   provider); `Send post-back` posts one terminal-state update through the
 *   live|mock port (honest failure past the attempt cap); `Ack` reuses the
 *   existing notification ack operation.
 * - Fail-safe visible: daemon unreachable renders a gray notice, never a
 *   broken page.
 *
 * ESM only, zero `require()`.
 */

import { useCallback, useEffect, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  getFactoryIntegrationsStatus,
  postFactoryIntegrationPostBack,
  postFactoryIntegrationTestPost,
  postFactoryNotificationAck,
} from "@/lib/factoryClient";
import type { FactoryIntegrationsLive } from "@/lib/factoryClient";

interface IntegrationPostView {
  id: string;
  title: string;
  body: string;
  at: string;
  acked: boolean;
  jobId: string | null;
}

function asText(value: unknown): string | null {
  try {
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function parsePost(value: unknown): IntegrationPostView | null {
  try {
    if (!value || typeof value !== "object") return null;
    const r = value as Record<string, unknown>;
    const id = asText(r.id);
    const title = asText(r.title);
    if (id === null || title === null) return null;
    return {
      id,
      title,
      body: typeof r.body === "string" ? r.body : "",
      at: asText(r.at) ?? "",
      acked: r.acked === true,
      jobId: asText(r.jobId),
    };
  } catch {
    return null;
  }
}

export function IntegrationsPanel(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [live, setLive] = useState<FactoryIntegrationsLive | null>(null);
  const [posts, setPosts] = useState<IntegrationPostView[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [acking, setAcking] = useState<string | null>(null);
  const [postingBack, setPostingBack] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState<string>("hello from Factory Lab");
  const [bodyInput, setBodyInput] = useState<string>("manual test post (mock only)");
  const [pbThreadInput, setPbThreadInput] = useState<string>("");
  const [pbJobInput, setPbJobInput] = useState<string>("");
  const [pbTitleInput, setPbTitleInput] = useState<string>("job complete");
  const [pbKindInput, setPbKindInput] = useState<string>("complete");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setError("factory unavailable");
        setEnabled(null);
        setLive(null);
        setPosts([]);
        return;
      }
      const res = await getFactoryIntegrationsStatus({ port });
      if (!res.ok) {
        setError(res.error || "factory unavailable");
        setEnabled(null);
        setLive(null);
        setPosts([]);
        return;
      }
      setEnabled(res.data.enabled);
      setMode(res.data.mode);
      setProvider(res.data.provider);
      setLive(res.data.live);
      const parsed: IntegrationPostView[] = [];
      try {
        for (const item of res.data.posts) {
          const row = parsePost(item);
          if (row) parsed.push(row);
        }
      } catch {
        // tolerant: partial rows still render
      }
      setPosts(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPosts([]);
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

  const handleSend = useCallback(async () => {
    setSending(true);
    setNotice(null);
    setError(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setError("factory unavailable");
        return;
      }
      const res = await postFactoryIntegrationTestPost(
        { title: titleInput, body: bodyInput },
        { port },
      );
      if (!res.ok) {
        setError(res.error || "test post failed");
        return;
      }
      setNotice("test post stored in the local mock");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [titleInput, bodyInput, refresh]);

  const handlePostBack = useCallback(async () => {
    setPostingBack(true);
    setNotice(null);
    setError(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setError("factory unavailable");
        return;
      }
      const res = await postFactoryIntegrationPostBack(
        {
          jobId: pbJobInput,
          threadId: pbThreadInput,
          kind: pbKindInput,
          title: pbTitleInput,
        },
        { port },
      );
      if (!res.ok) {
        setError(res.error || "post-back failed");
        return;
      }
      const via = res.data.via ?? "unknown";
      const remote = res.data.remoteId ? ` remote ${res.data.remoteId}` : "";
      setNotice(`post-back posted via ${via}${remote} (attempts ${res.data.attempts})`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPostingBack(false);
    }
  }, [pbJobInput, pbThreadInput, pbKindInput, pbTitleInput, refresh]);

  const handleAck = useCallback(    async (id: string) => {
      setAcking(id);
      setNotice(null);
      try {
        setPosts((prev) => {
          try {
            return prev.map((p) => (p.id === id ? { ...p, acked: true } : p));
          } catch {
            return prev;
          }
        });
        const port = await discoverFactoryPort();
        if (port === null) return;
        const res = await postFactoryNotificationAck(id, { port });
        if (!res.ok) {
          setNotice("ack kept locally (server did not confirm it)");
        } else {
          await refresh();
        }
      } catch {
        // ack is best-effort: the optimistic mark stays
      } finally {
        setAcking(null);
      }
    },
    [refresh],
  );

  const isLive = live?.liveMode === true;
  const badgeLabel = isLive
    ? `live-${live?.provider ?? provider ?? "linear"}`
    : provider !== null && mode !== null
      ? `${provider}-${mode}`
      : (provider ?? mode ?? "integrations ?");
  const filterLabel = !isLive
    ? null
    : live?.filterPresent === true
      ? "filter: custom"
      : live?.filterPresent === false
        ? "filter: accept-all"
        : "filter: ?";
  const postBackLabel = !isLive
    ? null
    : live?.allowPostBack === true
      ? "post-back: on"
      : live?.allowPostBack === false
        ? "post-back: off"
        : "post-back: ?";

  return (
    <section
      aria-label="Integrations"
      className="rounded-lg border border-zinc-200 bg-white p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold text-zinc-800">Integrations</h2>
        <span
          role="status"
          aria-live="polite"
          title={
            isLive
              ? "Live intake is ON (vault refs only, values never in repo/logs; green means provider traffic, not mock evidence)"
              : "P0 provider and mode from factory.yaml (amber means local mock evidence; green is reserved for live mode)"
          }
          className={
            isLive
              ? "inline-flex items-center rounded-md border border-green-200 bg-green-50 px-2 py-px font-mono text-[11px] font-medium text-green-800"
              : "inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-px font-mono text-[11px] font-medium text-amber-800"
          }
        >
          {badgeLabel}
        </span>
        {isLive && live?.hasCredentials === false ? (
          <span
            className="inline-flex items-center rounded bg-red-100 px-1.5 py-px text-[10px] font-medium text-red-700"
            title="liveMode is true but the vault ref resolves to nothing: live traffic is refused without network"
          >
            no credentials
          </span>
        ) : null}
        {filterLabel ? (
          <span
            className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-px font-mono text-[10px] font-medium text-zinc-500"
            title="Intake filter state from the live section (absent means accept-all)"
          >
            {filterLabel}
          </span>
        ) : null}
        {postBackLabel ? (
          <span
            className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-px font-mono text-[10px] font-medium text-zinc-500"
            title="Post-back kill-switch from the live section (allowPostBack)"
          >
            {postBackLabel}
          </span>
        ) : null}
        {enabled === false ? (
          <span className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-px text-[10px] font-medium text-zinc-500">
            outbound off
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-[11px] text-zinc-500" aria-live="polite">
          Loading integrations…
        </p>
      ) : null}
      {!loading && error ? (
        <p className="text-[11px] text-zinc-500" aria-live="polite" title={error}>
          No integration data (daemon unreachable). {error}
        </p>
      ) : null}
      {!loading && !error && notice ? (
        <p className="text-[11px] text-green-700" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[min(200px,100%)] flex-1 flex-col gap-1 text-[11px] text-zinc-600">
          <span>Title</span>
          <input
            aria-label="Test post title"
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="flex min-w-[min(200px,100%)] flex-1 flex-col gap-1 text-[11px] text-zinc-600">
          <span>Body</span>
          <input
            aria-label="Test post body"
            type="text"
            value={bodyInput}
            onChange={(e) => setBodyInput(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || loading}
          title="Store a test post in the local mock only (never a real provider)"
          className="inline-flex h-[30px] items-center justify-center rounded-md bg-zinc-900 px-3 text-[12px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
        >
          {sending ? "Sending…" : "Send test post"}
        </button>
      </div>

      <div className="mt-2 rounded-md border border-zinc-100 bg-zinc-50 p-2">
        <p className="text-[11px] font-semibold text-zinc-700">
          Post-back
          <span className="ml-1 font-normal text-zinc-400">
            (terminal-state update: live thread when liveMode is on, local mock otherwise)
          </span>
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[min(140px,100%)] flex-1 flex-col gap-1 text-[11px] text-zinc-600">
            <span>Thread / issue id</span>
            <input
              aria-label="Post-back thread id"
              type="text"
              value={pbThreadInput}
              onChange={(e) => setPbThreadInput(e.target.value)}
              placeholder="LIN-42"
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="flex min-w-[min(140px,100%)] flex-1 flex-col gap-1 text-[11px] text-zinc-600">
            <span>Job id</span>
            <input
              aria-label="Post-back job id"
              type="text"
              value={pbJobInput}
              onChange={(e) => setPbJobInput(e.target.value)}
              placeholder="job-…"
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-[12px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-zinc-600">
            <span>Kind</span>
            <select
              aria-label="Post-back kind"
              value={pbKindInput}
              onChange={(e) => setPbKindInput(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="complete">complete</option>
              <option value="ask_human">ask_human</option>
              <option value="proposal-ready">proposal-ready</option>
              <option value="benchmark-done">benchmark-done</option>
            </select>
          </label>
          <label className="flex min-w-[min(160px,100%)] flex-1 flex-col gap-1 text-[11px] text-zinc-600">
            <span>Title</span>
            <input
              aria-label="Post-back title"
              type="text"
              value={pbTitleInput}
              onChange={(e) => setPbTitleInput(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button
            type="button"
            onClick={() => void handlePostBack()}
            disabled={postingBack || loading}
            title="Post one terminal-state update back to the thread (honest failure past the attempt cap)"
            className="inline-flex h-[30px] items-center justify-center rounded-md bg-zinc-900 px-3 text-[12px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {postingBack ? "Posting…" : "Send post-back"}
          </button>
        </div>
      </div>

      {posts.length === 0 && !loading && !error ? (
        <p className="mt-2 text-[11px] text-zinc-500" aria-live="polite">
          No mock posts yet (send a test post above).
        </p>
      ) : null}

      {posts.length > 0 ? (
        <ul className="mt-2 divide-y divide-zinc-100">
          {posts.map((post) => (
            <li key={post.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-900" title={post.title}>
                  {post.title}
                </span>
                {post.acked ? (
                  <span className="text-[10px] font-medium text-green-700">acked</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleAck(post.id)}
                    disabled={acking === post.id}
                    aria-label={`Ack post: ${post.title}`}
                    className="shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-px text-[10px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
                  >
                    Ack
                  </button>
                )}
              </div>
              {post.body ? (
                <p className="mt-1 text-[11px] leading-snug text-zinc-600" title={post.body}>
                  {post.body.length > 280 ? `${post.body.slice(0, 280)}…` : post.body}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                {post.at ? <time dateTime={post.at}>{post.at}</time> : null}
                {post.jobId ? (
                  <a
                    href={`#job-${encodeURIComponent(post.jobId)}`}
                    title={`See job ${post.jobId}`}
                    className="font-mono text-zinc-500 underline decoration-dotted hover:text-zinc-700"
                  >
                    job {post.jobId}
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

export default IntegrationsPanel;
