/**
 * ReviewPanel — Ola 4.
 * Muestra lastReview (verdict, confidence, summary, findings) con polling 2.5s.
 * GET /factory/jobs/:id/review — sin reload, sin romper VerificationPanel.
 *
 * T3 (vista única): migrado al único importador de red del renderer
 * (`src/lib/factoryClient.ts`: `getFactoryReview` +
 * `postFactoryReviewAccept` + `postFactoryReviewRetry`, que nunca lanzan).
 * Misma ruta, mismo body `{}`, mismo timeout 3000, mismo polling 2.5s con
 * cleanup; el puerto descubierto se pasa explícito al cliente y sigue
 * alimentando el link "ver respuesta cruda". Formas y textos intactos
 * (C5 aditivo, polling intacto).
 */

import { useCallback, useEffect, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  getFactoryReview,
  postFactoryReviewAccept,
  postFactoryReviewRetry,
} from "@/lib/factoryClient";
import { humanizeReviewSummary } from "./reviewSummary";
import { DiscardJobButton } from "./DiscardJobButton";
import type { ReviewResult } from "../../../../shared/types/review";

const FETCH_TIMEOUT_MS = 3000;
const POLL_MS = 2500;

// T3 (vista única): red vía el único importador del renderer (sin acceso directo).
// El sobre defensivo del cliente se adapta a la forma local; ante !ok no-404
// se conserva lo último (polling vivo, igual que antes).

interface ReviewResponse {
  workItemId: string;
  status: string;
  reviewCount: number;
  lastReview: ReviewResult | null;
  hasRaw?: boolean;
}

function VerdictBadge({ verdict }: { verdict: ReviewResult["verdict"] }) {
  if (verdict === "accept") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold text-white">
        ✓ accept
      </span>
    );
  }
  if (verdict === "revise") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
        ↺ revise
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-purple-600 px-2 py-0.5 text-[11px] font-bold text-white">
      ? ask_human
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "blocker"
      ? "bg-red-600 text-white"
      : severity === "major"
        ? "bg-amber-500 text-white"
        : severity === "minor"
          ? "bg-blue-100 text-blue-800 border border-blue-200"
          : "bg-zinc-100 text-zinc-600 border border-zinc-200";
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {severity}
    </span>
  );
}

export function ReviewPanel({
  workItemId,
  className,
}: {
  workItemId: string | null;
  className?: string;
}) {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [factoryPort, setFactoryPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<"accept" | "retry" | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const fetchReview = useCallback(async () => {
    if (!workItemId) {
      setData(null);
      setFactoryPort(null);
      return;
    }
    setLoading(true);
    try {
      // T3: el puerto descubierto se pasa explícito al cliente (misma ruta,
      // mismo timeout) y sigue alimentando el link "ver respuesta cruda".
      const port = await discoverFactoryPort();
      setFactoryPort(port);
      if (port === null) {
        setLoading(false);
        return;
      }
      const res = await getFactoryReview(workItemId, { port, timeoutMs: FETCH_TIMEOUT_MS });
      if (!res.ok) {
        // 404 → limpia (igual que antes); otro !ok → conserva lo último
        // (polling vivo, cero spam).
        if (res.status === 404) setData(null);
        setLoading(false);
        return;
      }
      setData(res.data as unknown as ReviewResponse);
    } catch {
      // timeout/abort silencioso (polling vivo)
    } finally {
      setLoading(false);
    }
  }, [workItemId]);

  useEffect(() => {
    if (!workItemId) return;
    void fetchReview();
    const t = window.setInterval(() => {
      void fetchReview();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [fetchReview, workItemId]);

  const doAction = useCallback(
    async (kind: "accept" | "retry") => {
      if (!workItemId || acting) return;
      setActing(kind);
      setActionMsg(null);
      setActionErr(null);
      try {
        const port = await discoverFactoryPort();
        if (port === null) {
          setActionErr("daemon no disponible");
          return;
        }
        // T3: misma ruta + mismo body {} que el POST directo anterior.
        const res =
          kind === "accept"
            ? await postFactoryReviewAccept(workItemId, { port, timeoutMs: FETCH_TIMEOUT_MS })
            : await postFactoryReviewRetry(workItemId, { port, timeoutMs: FETCH_TIMEOUT_MS });
        if (!res.ok) {
          setActionErr(res.error);
          return;
        }
        const body = res.data as Record<string, unknown>;
        setActionMsg(
          kind === "accept"
            ? `Aceptado igual → Complete`
            : `Enviado a Building (status=${String(body.status ?? "Building")})`,
        );
        await fetchReview();
      } catch (e) {
        setActionErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
      } finally {
        setActing(null);
      }
    },
    [workItemId, acting, fetchReview],
  );

  if (!workItemId) {
    return (
      <div className={`rounded-lg border border-zinc-200 bg-zinc-50 p-3 ${className ?? ""}`} aria-live="polite">
        <h3 className="text-xs font-semibold text-zinc-800">Review</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          Seleccioná un WorkItem para ver el review automático (polling 2.5s)
        </p>
      </div>
    );
  }

  const review = data?.lastReview ?? null;
  const count = data?.reviewCount ?? 0;
  const status = data?.status ?? "—";

  return (
    <div className={`rounded-lg border border-zinc-200 bg-white p-3 ${className ?? ""}`} aria-live="polite">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-800">
          Review — {workItemId.slice(0, 12)}…{" "}
          <span className="font-normal text-zinc-500">
            (intento {review?.reviewAttempt ?? count} · count {count} · {status})
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {loading ? <span className="text-[11px] text-zinc-500">cargando…</span> : null}
          <button
            type="button"
            onClick={() => void fetchReview()}
            className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
          >
            refrescar
          </button>
        </div>
      </div>

      {!review ? (
        <div className="mt-2 text-[11px] text-zinc-500">
          Sin review todavía — {status === "Review" ? "revisor en curso (polling 2.5s)…" : `status ${status}, el review corre al llegar a Review`}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictBadge verdict={review.verdict} />
            <span className="text-[11px] text-zinc-600">
              confidence {(review.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-[11px] text-zinc-500">
              revisor: {review.reviewerModel.providerID}/{review.reviewerModel.modelID}
            </span>
            <span className="text-[11px] text-zinc-400">
              {review.reviewedAt ? new Date(review.reviewedAt).toLocaleString() : ""}
            </span>
          </div>

          {(() => {
            const human = humanizeReviewSummary(review.summary);
            return (
              <>
                <p className="break-words whitespace-pre-wrap text-[12px] leading-snug text-zinc-800">
                  {human.friendly}
                </p>
                {human.isInfraFailure ? (
                  <details className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
                    <summary className="cursor-pointer text-[11px] font-medium text-zinc-600 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500">
                      Detalle técnico
                    </summary>
                    <p className="mt-1 break-words whitespace-pre-wrap font-mono text-[10px] leading-snug text-zinc-600">
                      {human.technical}
                    </p>
                    {data?.hasRaw === true && factoryPort !== null ? (
                      <a
                        href={`http://127.0.0.1:${factoryPort}/factory/jobs/${encodeURIComponent(workItemId)}/review/raw`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-[11px] text-blue-700 underline hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        ver respuesta cruda
                      </a>
                    ) : null}
                  </details>
                ) : null}
              </>
            );
          })()}

          {review.findings.length === 0 ? (
            <div className="text-[11px] text-zinc-500">Sin findings — cambio limpio.</div>
          ) : (
            <ul className="space-y-2">
              {review.findings.map((f) => (
                <li
                  key={f.id}
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] leading-snug"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-zinc-700">{f.id}</span>
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">
                      {f.axis}
                    </span>
                    <SeverityBadge severity={f.severity} />
                    {f.file ? (
                      <span className="font-mono text-[10px] text-zinc-600">
                        {f.file}
                        {typeof f.line === "number" ? `:${f.line}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-zinc-700">{f.message}</div>
                  {f.suggestion ? (
                    <div className="mt-1 border-l-2 border-blue-200 pl-2 text-zinc-600">
                      → {f.suggestion}
                    </div>
                  ) : null}
                  {f.reverify ? (
                    <div className="mt-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Re-verificación solicitada
                      </div>
                      {f.reverify.reason ? (
                        <div className="mt-0.5 text-zinc-700">{f.reverify.reason}</div>
                      ) : null}
                      {f.reverify.commands.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {f.reverify.commands.map((c, i) => (
                            <li key={i} className="whitespace-pre-wrap break-all font-mono text-[10px] text-zinc-700">
                              $ {c}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {/* Ola 4 P1: acciones humanas solo si ask_human o revise */}
          {review.verdict === "ask_human" || review.verdict === "revise" ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void doAction("accept")}
                className="rounded bg-green-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                title="Review→Complete (override humano, crea .done)"
              >
                {acting === "accept" ? "aceptando…" : "Aceptar igual"}
              </button>
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void doAction("retry")}
                className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                title="Review→Building (re-dispara Implement)"
              >
                {acting === "retry" ? "enviando…" : "Mandar a Building"}
              </button>
              <DiscardJobButton jobId={workItemId} port={factoryPort} onDone={() => void fetchReview()} />
              {actionMsg ? <span className="text-[11px] text-green-700">{actionMsg}</span> : null}
              {actionErr ? <span className="text-[11px] text-red-700">{actionErr}</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default ReviewPanel;
