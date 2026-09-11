/**
 * factory/intake/intakeSession — TANDA B: decisiones puras de la sesión opencode.
 *
 * Dueño B en TANDA B: este módulo es dueño de la LÓGICA MOVIBLE del flujo de
 * sesiones opencode (`tryCreateOpencodeSession` del cascarón
 * `factoryServer.ts`): extracción del sessionId + formateo de errores del SDK
 * + constantes de timeouts. El cascarón conserva formas/handlers/tiempos y el
 * orquestador vivo; solo las decisiones puras delegan (alias delgados estilo
 * E1, cero cambios de call-sites).
 *
 * Alcance INTENCIONALMENTE acotado (carry-over B-S1 documentado en la suite,
 * no a ciegas): el orquestador completo (create con fallback de shapes,
 * cascada de prompt A/B/C, `isPromptVisible`, `withTimeout`/`withTimeoutRetry`)
 * queda en el cascarón porque (1) `tests/no-unbounded-loops.test.ts` pinea
 * sus needles ahí (`Timeout helper no bloqueante`, `abortTimer = setTimeout`
 * + 12000, `ctrl.abort(), 1000`, `withTimeoutRetry` + `isTimeoutErrorLocal`)
 * y prohíbe timers/loops en archivos nuevos del daemon, y (2)
 * `tests/mvp-prompt-inocuo.test.ts` + `mvp-builders-allowlist` pinean su texto
 * (`const promptText = buildMvpTrackingPing(job.id)`, título
 * `Factory <id> <phase>`, `job.sessionId = sessionId;`, 12000/2000). Moverlo
 * rompería suites ajenas (prohibido salvo re-run). Sin daemon vivo no se
 * re-verifican timeouts contra red real (carry-over B-S2).
 *
 * Decisión intacta (origen H-010, dueña intake/mvpBuilders): la sesión MVP
 * NUNCA recibe `job.prompt` crudo; el texto es SIEMPRE
 * `buildMvpTrackingPing(job.id)`. Los builders + ping + allowlist NO se
 * re-tocan (este módulo ni los importa: solo decisiones, C7).
 *
 * Timeouts de producción (espejo documentado, C5 aditivo, NO se retocan;
 * los valores vivos siguen en el cascarón):
 * - session.create: 8000ms (`sessionCreateMs` del yaml o fallback) + 1
 *   reintento solo ante timeout.
 * - prompt sync vivo: 12000ms. Prompt async / B / C: 2000ms.
 * - `isPromptVisible`: fetch 1000ms + SDK messages 1000ms.
 * - discovery 4096/40014: 800ms (vive en `getWorkingOpencodeUrl`).
 *
 * Reglas que honra (las 8 + C1–C10):
 * - C1 ESM y cotas: ESM puro, cero `require()`; sin temporizadores, sin
 *   polling, sin recorridos escritos a mano (solo predicados y accesos
 *   acotados; el scanner anti-loops del daemon queda en verde).
 * - C2 puras fail-safe: cada export con try y catch; nunca lanza.
 * - C3 un escritor: no escribe nada (ni jobs, ni disco, ni puertos).
 * - C4 disco best-effort: no aplica (cero disco acá).
 * - C5 aditivo: semántica idéntica a los bloques espejo del cascarón.
 * - C6/C7 vocabulario único, nada duplicado: cada helper tiene UN espejo
 *   citado; el cascarón llama acá (alias de 1 línea), no duplica.
 * - C8 rutas en tabla: no aplica (sesión post-201, no ruta).
 * - C9 testeable sin server vivo: todo export es puro (sin SDK, sin red).
 * - C10 trazabilidad: cada helper cita su espejo del cascarón.
 *
 * Lista blanca de imports (reparto TANDA B): NINGUNO (puro total; ni
 * siquiera builders: este módulo no compone payloads). PROHIBIDO: review,
 * triage, spec, measure, runner-executor y sus stores, notify,
 * definitionValidate, agentLoader, VerificationPanel, package.json, `src/*`,
 * runners yaml, persistencia, ping/builders (dominio intake, no se toca).
 */

/** Timeout vivo de session.create (espejo; el valor manda en el cascarón). */
export const INTAKE_SESSION_CREATE_MS = 8000;

/** Timeout vivo del prompt sync (espejo; el valor manda en el cascarón). */
export const INTAKE_PROMPT_SYNC_MS = 12000;

/** Timeout vivo del prompt async / variantes B y C (espejo). */
export const INTAKE_PROMPT_ASYNC_MS = 2000;

/** Timeout vivo de cada sonda de `isPromptVisible` (espejo). */
export const INTAKE_VISIBLE_MS = 1000;

/**
 * Extrae el sessionId de la respuesta del SDK (espejo del bloque de
 * normalización de `tryCreateOpencodeSession`: string `ses_*` directo,
 * `id/sessionID/sessionId/session_id` o anidado `session.id`). Puro, nunca
 * lanza (undefined ante forma desconocida; el caller decide el throw).
 */
export function extractIntakeSessionId(res: unknown): string | undefined {
  try {
    const maybeData =
      res !== null && typeof res === "object" && "data" in (res as Record<string, unknown>)
        ? (res as Record<string, unknown>).data
        : res;
    const dataObj = maybeData as Record<string, unknown> | string | null | undefined;
    if (typeof dataObj === "string" && dataObj.startsWith("ses_")) return dataObj;
    if (dataObj && typeof dataObj === "object") {
      const o = dataObj as Record<string, unknown>;
      const cand =
        (typeof o.id === "string" ? o.id : undefined) ??
        (typeof o.sessionID === "string" ? o.sessionID : undefined) ??
        (typeof o.sessionId === "string" ? o.sessionId : undefined) ??
        (typeof o.session_id === "string" ? o.session_id : undefined);
      if (cand) return cand;
      if (typeof o.session === "object" && o.session !== null) {
        const inner = o.session as Record<string, unknown>;
        const innerCand =
          (typeof inner.id === "string" ? inner.id : undefined) ??
          (typeof inner.sessionID === "string" ? inner.sessionID : undefined);
        if (innerCand) return innerCand;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Error del SDK en forma `{error}` (espejo de `hasResultError` del
 * cascarón): null = ok, string = JSON del error recortado a 180. Puro,
 * nunca lanza.
 */
export function intakeResultError(res: unknown): string | null {
  try {
    if (res !== null && typeof res === "object" && "error" in (res as Record<string, unknown>)) {
      const err = (res as Record<string, unknown>).error;
      if (err) {
        try {
          return JSON.stringify(err).slice(0, 180);
        } catch {
          return String(err).slice(0, 180);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Recorta el error a 140 chars sin saltos (espejo de `shortErr` del
 * cascarón). Puro, nunca lanza.
 */
export function shortIntakeError(e: unknown): string {
  try {
    const raw = e instanceof Error ? e.message : String(e);
    return raw.slice(0, 140).replace(/\s+/g, " ");
  } catch {
    return "unknown";
  }
}
