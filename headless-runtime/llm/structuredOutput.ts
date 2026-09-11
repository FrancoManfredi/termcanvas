/**
 * Structured output del servidor (módulo único, paridad Warp a nivel API).
 *
 * HISTORIAL: el servidor opencode expone `format: {type:"json_schema",
 * schema, retryCount?}` en `body` de `session.prompt` (SDK v2: la key viaja
 * en `body`, NO top-level). Con `format` el servidor inyecta la tool
 * `StructuredOutput` + system prompt + `toolChoice: "required"` y el modelo
 * devuelve el objeto validado en `info.structured`.
 *
 * DESHABILITADO POR DEFECTO (probe 2026-09-07, server 1.18.29 — última
 * publicada): el POST con `format` responde 200, pero el server guarda
 * `info.format` en el mensaje (con `retryCount:2` — default de
 * decodificación, aunque el payload lo omita) y TODA re-lectura de la
 * sesión (GET /session/:id/message, TUI y timeline incluidos) responde 400
 * `Expected OutputFormatJsonSchema, got {...}`. Reproducido con y sin
 * retryCount en el payload: no hay shape que sobreviva el roundtrip. Bug
 * del server, no del cliente. El beta (opencode2 v0.0.0-beta) no sirve como
 * reemplazo (otra API + password auth).
 *
 * Por eso el memo de capacidad arranca en `true` (payloads SIEMPRE en
 * texto plano) y el camino de texto (extract + repair + ask_human) queda
 * como único camino. Opt-in con `TERMCANVAS_STRUCTURED_OUTPUT=1` cuando el
 * server arregle el roundtrip; el memo por 400-real sigue aplicando igual.
 */

/** Reintentos de validación del servidor (flujo simple: 0, un solo intento). */
export const STRUCTURED_OUTPUT_RETRY_COUNT = 0;

/**
 * Memo de capacidad por proceso: marca SOLO 400s OutputFormat reales
 * (server degradado a mitad de corrida). El default OFF no vive acá: lo
 * decide `isFormatUnsupportedServer` por ausencia del opt-in env (ver
 * header). `TERMCANVAS_STRUCTURED_OUTPUT=1` re-habilita el intento con
 * `format` hasta que aparezca un 400-real. Puro.
 */
let formatUnsupportedMemo = false;

/**
 * ¿Este proceso NO debe mandar `format`? Default SÍ (roundtrip roto en
 * server 1.18.29, ver header). Env dinámico (leído por llamada, no en
 * import) para que tests y corridas puedan optar sin reiniciar proceso.
 */
export function isFormatUnsupportedServer(): boolean {
  try {
    if (process.env.TERMCANVAS_STRUCTURED_OUTPUT !== "1") return true;
    return formatUnsupportedMemo === true;
  } catch {
    return true;
  }
}

/** Marca el servidor como sin-`format` (tras un 400 OutputFormat). */
export function markFormatUnsupportedServer(): void {
  try {
    formatUnsupportedMemo = true;
  } catch {
    // noop: el reintento en texto igual se intenta en este turno
  }
}

/**
 * ¿Este error es el 400 de servidor-sin-`format` (`Expected
 * OutputFormatJsonSchema, got {...}`)? Solo ese caso justifica reintentar
 * en texto plano. OJO: `StructuredOutputError` (el modelo no llamó a la
 * tool) NO es este caso — ahí el servidor SÍ soporta format y se deja el
 * camino de error normal. Puro, nunca lanza.
 */
export function isFormatUnsupportedError(e: unknown): boolean {
  try {
    const m = e instanceof Error ? e.message : String(e ?? "");
    return m.includes("OutputFormatJsonSchema");
  } catch {
    return false;
  }
}

/** Clona un payload quitando `format` (reintento en texto plano). */
export function stripStructuredFormat(payload: unknown): Record<string, unknown> {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }
    const out = { ...(payload as Record<string, unknown>) };
    delete out.format;
    return out;
  } catch {
    return {};
  }
}

/** Envuelve un JSON Schema en el `format` que entiende el servidor. */
export function structuredFormat(schema: unknown): {
  type: "json_schema";
  schema: Record<string, unknown>;
  retryCount: number;
} {
  const clean =
    schema !== null && typeof schema === "object" && !Array.isArray(schema)
      ? (schema as Record<string, unknown>)
      : { type: "object" };
  return { type: "json_schema", schema: clean, retryCount: STRUCTURED_OUTPUT_RETRY_COUNT };
}

/**
 * Lee el objeto validado de la respuesta (`info.structured`, en las
 * envolturas `{data:{info}}` / `{info}` que devuelve el cliente v2).
 * Devuelve el JSON serializado listo para el parse zod, o null cuando no
 * hay structured (el caller sigue al camino de texto). Puro, nunca lanza.
 */
export function readStructuredRaw(res: unknown): string | null {
  try {
    if (!res || typeof res !== "object") return null;
    const rec = res as Record<string, unknown>;
    const data = rec.data;
    const info =
      data !== null && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>).info
        : rec.info;
    if (!info || typeof info !== "object" || Array.isArray(info)) return null;
    const structured = (info as Record<string, unknown>).structured;
    if (structured === undefined || structured === null) return null;
    if (typeof structured === "string") return structured;
    try {
      return JSON.stringify(structured);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
