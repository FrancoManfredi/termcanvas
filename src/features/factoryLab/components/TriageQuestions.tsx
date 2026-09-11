/**
 * TriageQuestions — H-002 (E2, UI del Triage-humano).
 *
 * Render aditivo en la celda de status de `WorkItemList` cuando el job está
 * en Triage: muestra las `openQuestions` concretas (área / criterio /
 * restricciones con LLM sano) + reason/confidence que ya se mostraba, más
 * un control para responder/derivar:
 * - "Responder y reanudar" → POST .../triage/respond (nuevo, aditivo) que
 *   hace Triage→Foreman (transición existente) y re-dispara el foreman.
 * - "Derivar a humano" → POST .../cancel (endpoint EXISTENTE, reuse:
 *   Triage→Cancelled ya permitida; este archivo no inventa transiciones).
 *
 * Sin polling nuevo: tras responder, el tick global de 2.5s
 * (`useWorkItemsPolling`) trae el status nuevo solo. Sin preguntas muestra
 * reason + mensaje honesto (TRIAGE_NO_QUESTIONS_TEXT), sin romper.
 *
 * ESM puro, cero `require()`.
 */

import { useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  buildTriageDeriveUrl,
  normalizeTriageAnswers,
  postTriageRespond,
  type TriageInfo,
} from "./triageUi";

/** Mensaje honesto cuando el triage no trae preguntas (H-002, E2E-03). */
export const TRIAGE_NO_QUESTIONS_TEXT =
  "Triage sin preguntas concretas: contanos el contexto con tus palabras o derivá a humano.";

const FETCH_TIMEOUT_MS = 3000;

export function TriageQuestions({
  jobId,
  info,
}: {
  jobId: string;
  info: TriageInfo;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [freeText, setFreeText] = useState<string>("");
  const [sending, setSending] = useState<"respond" | "derive" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const orderedAnswers = (): string[] => {
    if (info.hasQuestions) {
      return info.openQuestions.map((_, i) => drafts[i] ?? "");
    }
    return [freeText];
  };

  const canSend = normalizeTriageAnswers(orderedAnswers()) !== null && sending === null;

  async function handleRespond(): Promise<void> {
    if (sending) return;
    const answers = normalizeTriageAnswers(orderedAnswers());
    if (!answers) {
      setErr("Escribí al menos una respuesta antes de reanudar.");
      return;
    }
    setSending("respond");
    setMsg(null);
    setErr(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setErr("daemon no disponible");
        return;
      }
      const res = await postTriageRespond(fetch, port, jobId, answers, FETCH_TIMEOUT_MS);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(`Respuestas enviadas → ${res.status} (el listado se actualiza solo)`);
      setDrafts({});
      setFreeText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    } finally {
      setSending(null);
    }
  }

  // TODO(F4-vista-única): migrar a src/lib/factoryClient.ts (único importador de red del renderer); carry-over F4-E2: el acceso directo actual NO se toca en esta tanda.
  async function handleDerive(): Promise<void> {
    if (sending) return;
    setSending("derive");
    setMsg(null);
    setErr(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setErr("daemon no disponible");
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(buildTriageDeriveUrl(port, jobId), {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          let detail = `error ${res.status}`;
          try {
            const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
            if (typeof parsed.error === "string" && parsed.error.length > 0) detail = parsed.error;
          } catch {
            // usa el status
          }
          setErr(detail.slice(0, 200));
          return;
        }
        setMsg("Derivado a humano → Cancelled (el listado se actualiza solo)");
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    } finally {
      setSending(null);
    }
  }

  return (
    <div
      className="mt-1 max-w-[260px] rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900"
      aria-live="polite"
      aria-label={`Preguntas de triage para ${jobId}`}
    >
      {info.reason ? (
        <p className="select-text whitespace-pre-wrap break-words">
          <span className="font-semibold">Triage:</span> “{info.reason}”
        </p>
      ) : null}
      {info.confidence !== null ? (
        <p className="mt-0.5 font-mono text-[10px] text-amber-700">
          confidence={Math.round(info.confidence * 100)}%
          {info.decision ? ` decision=${info.decision}` : ""}
        </p>
      ) : null}
      {info.hasQuestions ? (
        <ol className="mt-1 list-decimal space-y-1 pl-4">
          {info.openQuestions.map((q, i) => (
            <li key={i}>
              <span className="select-text whitespace-pre-wrap break-words font-medium">{q}</span>
              <input
                type="text"
                value={drafts[i] ?? ""}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [i]: e.target.value }))}
                placeholder={`Respuesta ${i + 1}`}
                aria-label={`Respuesta a pregunta ${i + 1}: ${q.slice(0, 60)}`}
                className="mt-0.5 w-full rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-1">
          <p>{TRIAGE_NO_QUESTIONS_TEXT}</p>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="Contexto libre para el foreman…"
            aria-label="Contexto libre para el triage sin preguntas"
            rows={2}
            className="mt-1 w-full rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void handleRespond()}
          title="POST triage/respond: Triage→Foreman con tus respuestas (re-corre el foreman)"
          className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          {sending === "respond" ? "enviando…" : "Responder y reanudar"}
        </button>
        <button
          type="button"
          disabled={sending !== null}
          onClick={() => void handleDerive()}
          title="POST cancel existente: Triage→Cancelled (deriva a humano, sin re-correr nada)"
          className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          {sending === "derive" ? "derivando…" : "Derivar a humano"}
        </button>
      </div>
      {msg ? <p className="mt-1 text-[11px] font-medium text-green-700">{msg}</p> : null}
      {err ? <p className="mt-1 text-[11px] font-medium text-red-700">{err}</p> : null}
    </div>
  );
}

export default TriageQuestions;
