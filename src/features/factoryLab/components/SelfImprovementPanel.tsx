/**
 * SelfImprovementPanel — Ola 13 (Measure: Self-improvement).
 * Espejo de BenchmarksPanel: discoverFactoryPort, fetchWithTimeout, polling con
 * setInterval + cleanup, estados loading/posting/msg/err, botones de acción con
 * POST, badges, español, aria/focus-visible.
 *
 * - Selector de scorer (texto libre + 3 sugerencias reales) + botón "ver
 *   failures" (GET /factory/improve/failures).
 * - Botón "generar propuesta" (POST /factory/improve/proposals) con aviso
 *   honesto de costo ANTES del POST.
 * - Lista de propuestas (GET /factory/improve/proposals) cada 15s.
 * - Detalle de la propuesta seleccionada (GET /factory/improve/proposals/:id):
 *   fetch al seleccionar + polling cada 5s SOLO si status=pending.
 * - Adoptar/Descartar SOLO si status=ready, con confirmación visual inline de
 *   2 clicks ("esta acción escribe en factory/ — ¿confirmar?"). CERO auto-adopt:
 *   ningún POST a adopt/discard sin click + confirmación.
 * - Nada se adopta sin review humano (§2.4): nota visible permanente.
 * - Todo campo ausente o forma inesperada → "sin datos", nunca rompe.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  KNOWN_SCORERS,
  adoptUrl,
  canDecide,
  discardUrl,
  failuresUrl,
  formatProposalDate,
  parseFailuresList,
  parseProposalDetail,
  parseProposalsList,
  proposalStatusBadge,
  proposalUrl,
  proposePayload,
  proposalsUrl,
  regressionsSummary,
  targetShort,
  type FailureItem,
  type ProposalDetail,
  type ProposalSummary,
} from "./improvementUi";
import {
  notificationAckUrl,
  notificationsUrl,
  parseNotificationsResponse,
  type UiNotification,
} from "./notificationsUi";

const FETCH_TIMEOUT_MS = 3000;
const POST_TIMEOUT_MS = 10000;
const POLL_LIST_MS = 15000;
const POLL_DETAIL_MS = 5000;

// TODO(F4-vista-única): migrar a src/lib/factoryClient.ts (único importador de red del renderer); carry-over F4-E2: el acceso directo actual NO se toca en esta tanda.
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
/** Extrae el mensaje {error} del backend o un fallback con el status. */
async function readErrorBody(res: Response): Promise<string> {

  let text = "";
  try {
    text = await res.text();
  } catch {
    return `error ${res.status}`;
  }
  if (!text) return `error ${res.status}`;
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error.trim().slice(0, 300);
    }
  } catch {
    return text.slice(0, 300);
  }
  return `error ${res.status}`;
}

// ── F3-T3: decidir desde la notificación (wiring +0, sin polling nuevo) ──
// proposal-decide-link NO sumó ruta (ver routing/routeTable.ts): compone seams
// existentes (adopt/discard por id + ack de notificación). El id imp-… se
// extrae del texto con el mismo shape estricto del engine
// (`extractProposalIdFromNotification`), acotado a 2000 chars. Todo acá es
// on-demand (clics), cero setInterval nuevo: la lista vive de las polls
// existentes (15s propuestas) más este fetch manual.

/** Kind que anuncia una propuesta lista (espejo del centro de notificaciones). */
const NOTIF_READY_KIND = "proposal-ready";

/** Tope de notificaciones proposal-ready visibles (lista corta, on-demand). */
const NOTIF_READY_MAX = 10;

/** Tope de escaneo de texto para extraer el id (espejo del engine). */
const NOTIF_SCAN_MAX = 2000;

/** Primera mención imp-… en texto libre (el id de centro n-… jamás matchea). */
const NOTIF_PROPOSAL_PATTERN = /imp-[A-Za-z0-9-]+/;

/** Shape estricto del id de propuesta (sin traversal, sin espacios). */
const NOTIF_PROPOSAL_STRICT = /^imp-[A-Za-z0-9-]+$/;

function isSafeNotifProposalId(id: string): boolean {
  try {
    if (id.length === 0 || id.length > 128) return false;
    if (id.trim() !== id) return false;
    if (!NOTIF_PROPOSAL_STRICT.test(id)) return false;
    if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Extrae el id de propuesta anunciado en un texto (null si no hay). Nunca lanza. */
function extractProposalIdFromNotifText(text: unknown): string | null {
  try {
    if (typeof text !== "string" || text.length === 0) return null;
    const match = NOTIF_PROPOSAL_PATTERN.exec(text.slice(0, NOTIF_SCAN_MAX));
    if (!match || !match[0]) return null;
    return isSafeNotifProposalId(match[0]) ? match[0] : null;
  } catch {
    return null;
  }
}

/** Id anunciado por la notificación (body primero, título después). Nunca lanza. */
function notifProposalId(notif: UiNotification): string | null {
  try {
    return (
      extractProposalIdFromNotifText(notif.body) ?? extractProposalIdFromNotifText(notif.title)
    );
  } catch {
    return null;
  }
}

function StatusBadge({ status }: { status: string }) {
  const { tone, label } = proposalStatusBadge(status);
  const bg =
    tone === "blue"
      ? "bg-blue-600"
      : tone === "amber"
        ? "bg-amber-500"
        : tone === "red"
          ? "bg-red-600"
          : tone === "green"
            ? "bg-green-600"
            : "bg-zinc-400";
  return (
    <span
      className={`inline-flex items-center rounded-full ${bg} px-2 py-0.5 text-[11px] font-bold text-white`}
    >
      {label}
    </span>
  );
}

export function SelfImprovementPanel({ className }: { className?: string }) {
  const [scorer, setScorer] = useState("");
  const [failures, setFailures] = useState<FailureItem[]>([]);
  const [failuresLoaded, setFailuresLoaded] = useState(false);
  const [loadingFailures, setLoadingFailures] = useState(false);
  const [failuresErr, setFailuresErr] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [posting, setPosting] = useState(false);
  const [deciding, setDeciding] = useState<null | "adopt" | "discard">(null);
  const [confirmAction, setConfirmAction] = useState<null | "adopt" | "discard">(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const selectProposal = useCallback((id: string | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setConfirmAction(null);
    if (id === null) setDetail(null);
  }, []);

  const fetchProposals = useCallback(async () => {
    setLoadingList(true);
    try {
      const port = await discoverFactoryPort();
      if (port === null) return;
      try {
        const res = await fetchWithTimeout(proposalsUrl(port), {}, FETCH_TIMEOUT_MS);
        if (!res.ok) return;
        const json: unknown = await res.json().catch(() => null);
        const list = parseProposalsList(json);
        setProposals(list);
        if (selectedIdRef.current === null && list.length > 0) {
          selectedIdRef.current = list[0].id;
          setSelectedId(list[0].id);
        }
      } catch {
        // timeout/abort silencioso (polling vivo)
      }
    } catch {
      // discovery falló: polling vivo, sin romper
    } finally {
      setLoadingList(false);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const port = await discoverFactoryPort();
      if (port === null) return;
      try {
        const res = await fetchWithTimeout(proposalUrl(port, id), {}, FETCH_TIMEOUT_MS);
        if (selectedIdRef.current !== id) return;
        if (!res.ok) {
          if (res.status === 404) setDetail(null);
          return;
        }
        const json: unknown = await res.json().catch(() => null);
        if (selectedIdRef.current !== id) return;
        setDetail(parseProposalDetail(json));
      } catch {
        // timeout/abort silencioso (polling vivo)
      }
    } catch {
      // discovery falló: polling vivo, sin romper
    } finally {
      if (selectedIdRef.current === id) setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void fetchProposals();
    const t = window.setInterval(() => {
      void fetchProposals();
    }, POLL_LIST_MS);
    return () => window.clearInterval(t);
  }, [fetchProposals]);

  useEffect(() => {
    if (!selectedId) return;
    void fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  const detailStatus = detail && selectedId ? detail.status : null;
  useEffect(() => {
    if (!selectedId || detailStatus !== "pending") return;
    const t = window.setInterval(() => {
      void fetchDetail(selectedId);
    }, POLL_DETAIL_MS);
    return () => window.clearInterval(t);
  }, [selectedId, detailStatus, fetchDetail]);

  const fetchFailures = useCallback(async () => {
    const name = scorer.trim();
    if (!name) {
      setFailuresErr("elegí o escribí un scorer primero");
      return;
    }
    setLoadingFailures(true);
    setFailuresErr(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setFailuresErr("daemon no disponible");
        return;
      }
      const res = await fetchWithTimeout(failuresUrl(port, name), {}, FETCH_TIMEOUT_MS);
      if (!res.ok) {
        setFailuresErr(await readErrorBody(res));
        return;
      }
      const json: unknown = await res.json().catch(() => null);
      setFailures(parseFailuresList(json));
      setFailuresLoaded(true);
    } catch (e) {
      setFailuresErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    } finally {
      setLoadingFailures(false);
    }
  }, [scorer]);

  const propose = useCallback(async () => {
    if (posting) return;
    const name = scorer.trim();
    if (!name) {
      setActionMsg(null);
      setActionErr("elegí o escribí un scorer primero");
      return;
    }
    setPosting(true);
    setActionMsg(null);
    setActionErr(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setActionErr("daemon no disponible");
        return;
      }
      const res = await fetchWithTimeout(
        proposalsUrl(port),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proposePayload(name)),
        },
        POST_TIMEOUT_MS,
      );
      if (!res.ok) {
        setActionErr(await readErrorBody(res));
        return;
      }
      const json: unknown = await res.json().catch(() => null);
      const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      const id = rec && typeof rec.id === "string" && rec.id.length > 0 ? rec.id : null;
      setActionMsg(
        id
          ? `propuesta ${id.slice(0, 12)}… creada: el análisis corre en segundo plano (la lista se actualiza cada 15s)`
          : "propuesta creada: el análisis corre en segundo plano (la lista se actualiza cada 15s)",
      );
      await fetchProposals();
      if (id) selectProposal(id);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    } finally {
      setPosting(false);
    }
  }, [scorer, posting, fetchProposals, selectProposal]);

  const decideForId = useCallback(
    async (action: "adopt" | "discard", id: string): Promise<void> => {
      if (!id || deciding) return;
      setDeciding(action);
      setActionMsg(null);
      setActionErr(null);
      try {
        const port = await discoverFactoryPort();
        if (port === null) {
          setActionErr("daemon no disponible");
          return;
        }
        const url = action === "adopt" ? adoptUrl(port, id) : discardUrl(port, id);
        const res = await fetchWithTimeout(url, { method: "POST" }, POST_TIMEOUT_MS);
        if (!res.ok) {
          setActionErr(await readErrorBody(res));
          return;
        }
        if (action === "adopt") {
          const json: unknown = await res.json().catch(() => null);
          const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
          const target = typeof rec.target === "string" && rec.target ? rec.target : "—";
          const backup =
            typeof rec.backup === "string" && rec.backup ? ` (backup en ${rec.backup})` : "";
          setActionMsg(`adoptada: ${target}${backup}`);
        } else {
          setActionMsg("propuesta descartada");
        }
        setConfirmAction(null);
        await fetchProposals();
        await fetchDetail(id);
      } catch (e) {
        setActionErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
      } finally {
        setDeciding(null);
      }
    },
    [deciding, fetchProposals, fetchDetail],
  );

  const decide = useCallback(
    (action: "adopt" | "discard"): Promise<void> => {
      const id = selectedIdRef.current;
      if (!id) return Promise.resolve();
      return decideForId(action, id);
    },
    [decideForId],
  );

  // ── F3-T3: decidir desde la notificación (on-demand, 0 polling nuevo) ──

  const [readyNotifs, setReadyNotifs] = useState<UiNotification[]>([]);
  const [notifsLoaded, setNotifsLoaded] = useState(false);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [notifsErr, setNotifsErr] = useState<string | null>(null);
  const [notifActionMsg, setNotifActionMsg] = useState<string | null>(null);
  const [decidingNotif, setDecidingNotif] = useState(false);
  const [confirmNotif, setConfirmNotif] = useState<{
    notifId: string;
    proposalId: string;
    action: "adopt" | "discard";
  } | null>(null);

  const fetchReadyNotifs = useCallback(async () => {
    setLoadingNotifs(true);
    setNotifsErr(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setNotifsErr("daemon no disponible");
        return;
      }
      const res = await fetchWithTimeout(notificationsUrl(port), {}, FETCH_TIMEOUT_MS);
      if (!res.ok) {
        setNotifsErr(await readErrorBody(res));
        return;
      }
      const json: unknown = await res.json().catch(() => null);
      const parsed = parseNotificationsResponse(json);
      const ready = parsed.notifications
        .filter((n) => n.kind === NOTIF_READY_KIND)
        .slice(0, NOTIF_READY_MAX);
      setReadyNotifs(ready);
      setNotifsLoaded(true);
    } catch (e) {
      setNotifsErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    } finally {
      setLoadingNotifs(false);
    }
  }, []);

  const decideFromNotif = useCallback(
    async (action: "adopt" | "discard", notif: UiNotification): Promise<void> => {
      const proposalId = notifProposalId(notif);
      if (!proposalId) {
        setNotifActionMsg("esa notificación no anuncia ningún id de propuesta (imp-…)");
        return;
      }
      if (decidingNotif) return;
      setDecidingNotif(true);
      setNotifActionMsg(null);
      try {
        await decideForId(action, proposalId);
        // El engine también acusa la notificación (best-effort: si falla, se nota, no se rompe).
        let ackNote = "";
        try {
          const port = await discoverFactoryPort();
          if (port !== null) {
            const ack = await fetchWithTimeout(
              notificationAckUrl(port, notif.id),
              { method: "POST" },
              POST_TIMEOUT_MS,
            );
            if (!ack.ok) ackNote = " (el ack de la notificación falló: la propuesta igual quedó decidida)";
          }
        } catch {
          ackNote = " (el ack de la notificación falló: la propuesta igual quedó decidida)";
        }
        selectProposal(proposalId);
        setNotifActionMsg(
          `propuesta ${proposalId.slice(0, 24)}… ${action === "adopt" ? "adoptada" : "descartada"} desde la notificación${ackNote}`,
        );
        setConfirmNotif(null);
        await fetchReadyNotifs();
      } finally {
        setDecidingNotif(false);
      }
    },
    [decideForId, decidingNotif, fetchReadyNotifs, selectProposal],
  );

  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white p-3 ${className ?? ""}`}
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-800">
          Self-improvement{" "}
          <span className="font-normal text-zinc-500">
            ({proposals.length} {proposals.length === 1 ? "propuesta" : "propuestas"})
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {loadingList ? <span className="text-[11px] text-zinc-500">cargando…</span> : null}
          <button
            type="button"
            onClick={() => {
              void fetchProposals();
            }}
            className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            refrescar
          </button>
        </div>
      </div>

      <p className="mt-1 rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-[11px] leading-snug text-green-800">
        nada se adopta sin tu revisión: cada propuesta espera tu Adoptar/Descartar
      </p>

      <div className="mt-2">
        <label htmlFor="improve-scorer" className="text-[11px] font-semibold text-zinc-700">
          Scorer
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id="improve-scorer"
            type="text"
            value={scorer}
            onChange={(e) => {
              setScorer(e.target.value);
              setFailuresLoaded(false);
              setFailuresErr(null);
            }}
            placeholder="nombre del scorer"
            spellCheck={false}
            className="min-w-[min(220px,100%)] flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            disabled={loadingFailures}
            onClick={() => void fetchFailures()}
            className="rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            {loadingFailures ? "buscando…" : "ver failures"}
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5" aria-label="Scorers sugeridos">
          {KNOWN_SCORERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setScorer(s);
                setFailuresLoaded(false);
                setFailuresErr(null);
              }}
              className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              {s}
            </button>
          ))}
        </div>
        {failuresErr ? (
          <p className="mt-1 text-[11px] text-red-700" aria-live="polite">
            {failuresErr}
          </p>
        ) : null}
        {failuresLoaded && !failuresErr ? (
          failures.length === 0 ? (
            <p className="mt-1 text-[11px] text-zinc-500">
              sin failures para este scorer — nada que analizar (probá con otro scorer).
            </p>
          ) : (
            <ul className="mt-1 max-h-40 overflow-auto rounded-md border border-zinc-200">
              {failures.map((f, idx) => (
                <li
                  key={`${f.workItemId}-${f.at}-${idx}`}
                  className="border-b border-zinc-100 px-2 py-1.5 text-[11px] last:border-b-0"
                >
                  <span className="block font-mono text-zinc-800">{f.workItemId}</span>
                  <span className="block text-zinc-600">
                    {f.label || "—"} · {f.reason || "—"}
                  </span>
                  {f.promptPreview ? (
                    <span className="block truncate text-[10px] text-zinc-500">
                      {f.promptPreview}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {proposals.length === 0 ? (
        <div className="mt-2 text-[11px] text-zinc-500">
          Todavía no hay propuestas — elegí un scorer, mirá sus failures y generá la primera (la
          lista se actualiza cada 15s).
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2 md:flex-row">
          <ul className="max-h-56 w-full overflow-auto rounded-md border border-zinc-200 md:w-64 md:shrink-0">
            {proposals.map((p) => {
              const active = p.id === selectedId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selectProposal(p.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 ${
                      active ? "bg-zinc-100 font-semibold" : ""
                    }`}
                  >
                    <StatusBadge status={p.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-zinc-800">
                        {p.pattern || "sin patrón"}
                      </span>
                      <span className="block truncate text-[10px] text-zinc-500">
                        {targetShort(p.target)} · {regressionsSummary(p.regressionsAddressed)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="min-w-0 flex-1">
            {!selectedId ? (
              <div className="text-[11px] text-zinc-500">
                Seleccioná una propuesta para ver el detalle.
              </div>
            ) : loadingDetail && !detail ? (
              <div className="text-[11px] text-zinc-500">cargando detalle…</div>
            ) : !detail ? (
              <div className="text-[11px] text-zinc-500">sin datos — el backend no devolvió la propuesta.</div>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <StatusBadge status={detail.status} />
                  <span className="font-semibold text-zinc-800">
                    {detail.pattern || "sin patrón"}
                  </span>
                  <span className="text-zinc-500">
                    {detail.scorer || "—"} · {targetShort(detail.target)} · creado{" "}
                    {formatProposalDate(detail.createdAt)}
                    {detail.decidedAt ? ` · decidida ${formatProposalDate(detail.decidedAt)}` : ""}
                  </span>
                </div>

                <p className="mt-1 text-[11px] text-zinc-500">
                  {regressionsSummary(detail.regressionsAddressed)}
                </p>

                <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-snug text-zinc-700">
                  {detail.rationale || "sin datos"}
                </p>

                {detail.newContent ? (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-800">
                    {detail.newContent}
                  </pre>
                ) : (
                  <div className="mt-2 text-[11px] text-zinc-500">
                    sin contenido nuevo todavía
                    {detail.status === "pending" ? " (sigue analizando…)" : ""}.
                  </div>
                )}

                {detail.status === "failed" ? (
                  <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-800">
                    {detail.failureReason || "falló sin motivo visible"}
                  </p>
                ) : null}

                {detail.status === "adopted" && detail.backupPath ? (
                  <p className="mt-2 text-[11px] text-zinc-600">backup en {detail.backupPath}</p>
                ) : null}

                {canDecide(detail.status) ? (
                  <div className="mt-2 border-t border-zinc-100 pt-2">
                    {confirmAction === null ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={deciding !== null}
                          onClick={() => setConfirmAction("adopt")}
                          className="rounded bg-green-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1"
                        >
                          Adoptar
                        </button>
                        <button
                          type="button"
                          disabled={deciding !== null}
                          onClick={() => setConfirmAction("discard")}
                          className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                        >
                          Descartar
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p
                          className="text-[11px] font-medium text-amber-800"
                          aria-live="polite"
                        >
                          esta acción escribe en factory/ — ¿confirmar{" "}
                          {confirmAction === "adopt" ? "adopción" : "descarte"}?
                        </p>
                        <div className="mt-1 flex gap-2">
                          <button
                            type="button"
                            disabled={deciding !== null}
                            onClick={() => void decide(confirmAction)}
                            className="rounded bg-green-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1"
                          >
                            {deciding
                              ? "aplicando…"
                              : confirmAction === "adopt"
                                ? "sí, adoptar"
                                : "sí, descartar"}
                          </button>
                          <button
                            type="button"
                            disabled={deciding !== null}
                            onClick={() => setConfirmAction(null)}
                            className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                          >
                            cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-zinc-100 pt-2">
        <h4 className="text-[11px] font-semibold text-zinc-700">
          Decidir desde la notificación
        </h4>
        <p className="mt-0.5 text-[10px] text-zinc-500">
          las propuestas listas llegan como notificación proposal-ready: elegí una y
          adoptá/descartá sin salir de acá (usa las rutas existentes adopt/discard + ack).
        </p>
        <div className="mt-1.5">
          <button
            type="button"
            disabled={loadingNotifs}
            onClick={() => void fetchReadyNotifs()}
            className="rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            {loadingNotifs ? "buscando…" : "buscar proposal-ready"}
          </button>
        </div>
        {notifsErr ? (
          <p className="mt-1 text-[11px] text-red-700" aria-live="polite">
            {notifsErr}
          </p>
        ) : null}
        {notifsLoaded && !notifsErr ? (
          readyNotifs.length === 0 ? (
            <p className="mt-1 text-[11px] text-zinc-500">
              sin notificaciones proposal-ready — cuando el auto-propose genere una, aparece acá.
            </p>
          ) : (
            <ul className="mt-1 max-h-56 overflow-auto rounded-md border border-zinc-200">
              {readyNotifs.map((n) => {
                const pid = notifProposalId(n);
                const confirming =
                  confirmNotif !== null && confirmNotif.notifId === n.id ? confirmNotif : null;
                return (
                  <li
                    key={n.id}
                    className="border-b border-zinc-100 px-2 py-1.5 text-[11px] last:border-b-0"
                  >
                    <span className="block truncate font-medium text-zinc-800">{n.title}</span>
                    <span className="block truncate text-[10px] text-zinc-500">{n.body}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {pid ? (
                        <span className="rounded-full bg-blue-100 px-2 py-px font-mono text-[10px] font-bold text-blue-800">
                          {pid}
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-700">
                          sin id de propuesta en el texto
                        </span>
                      )}
                      {n.acked ? (
                        <span className="text-[10px] text-zinc-400">acusada</span>
                      ) : null}
                    </span>
                    {pid ? (
                      confirming === null ? (
                        <span className="mt-1 flex gap-2">
                          <button
                            type="button"
                            disabled={decidingNotif || deciding !== null}
                            onClick={() =>
                              setConfirmNotif({ notifId: n.id, proposalId: pid, action: "adopt" })
                            }
                            className="rounded bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1"
                          >
                            Adoptar
                          </button>
                          <button
                            type="button"
                            disabled={decidingNotif || deciding !== null}
                            onClick={() =>
                              setConfirmNotif({ notifId: n.id, proposalId: pid, action: "discard" })
                            }
                            className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                          >
                            Descartar
                          </button>
                        </span>
                      ) : (
                        <span className="mt-1 block">
                          <span className="block text-[11px] font-medium text-amber-800" aria-live="polite">
                            esta acción decide {confirming.proposalId.slice(0, 24)}… (
                            {confirming.action === "adopt" ? "adopción" : "descarte"}) y acusa la
                            notificación — ¿confirmar?
                          </span>
                          <span className="mt-1 flex gap-2">
                            <button
                              type="button"
                              disabled={decidingNotif}
                              onClick={() => void decideFromNotif(confirming.action, n)}
                              className="rounded bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1"
                            >
                              {decidingNotif
                                ? "aplicando…"
                                : confirming.action === "adopt"
                                  ? "sí, adoptar"
                                  : "sí, descartar"}
                            </button>
                            <button
                              type="button"
                              disabled={decidingNotif}
                              onClick={() => setConfirmNotif(null)}
                              className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                            >
                              cancelar
                            </button>
                          </span>
                        </span>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
        {notifActionMsg ? (
          <p className="mt-1 text-[11px] text-green-700" aria-live="polite">
            {notifActionMsg}
          </p>
        ) : null}
      </div>

      <div className="mt-3 border-t border-zinc-100 pt-2">
        <p className="text-[11px] font-medium text-amber-800" aria-live="polite">
          el análisis consume llamadas LLM y propone un cambio que SOLO se aplica si lo adoptás
        </p>
        <div className="mt-1.5">
          <button
            type="button"
            disabled={posting}
            onClick={() => void propose()}
            className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          >
            {posting ? "generando…" : "generar propuesta"}
          </button>
        </div>
      </div>

      {actionMsg || actionErr ? (
        <div className="mt-2 border-t border-zinc-100 pt-2" aria-live="polite">
          {actionMsg ? <span className="text-[11px] text-green-700">{actionMsg}</span> : null}
          {actionErr ? <span className="text-[11px] text-red-700">{actionErr}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export default SelfImprovementPanel;
