/**
 * notificationsUi — Ola 19 E2 (Paridad Warp: notificaciones locales, lado UI + toast).
 *
 * Helpers puros (sin React, sin DOM) para `NotificationsBell.tsx` + contrato
 * testeable offline por `tests/notifications-ui.test.ts`.
 *
 * Contrato que se consume (lo implementó E1; espejo estructural, SIN importar
 * tipos del backend: la UI ESM no depende de `headless-runtime`):
 * - `GET /factory/notifications` → `{ notifications, notificationsEnabled,
 *   osNotifications }` (apagado → `notifications: []`).
 * - `POST /factory/notifications/:id/ack` → `{ ok:true, notification }`
 *   o 404 `{ error:"notification not found" }`.
 * - Flags yaml `notificationsEnabled` (centro) + `osNotifications` (toast),
 *   default true.
 *
 * Reglas (las 8) aplicadas acá:
 * - Cero hardcodeos: el puerto siempre viene del caller (discovery); las
 *   cotas viven en constantes exportadas (`POLL_MS`, `TOASTED_IDS_CAP`).
 * - Sin spam: sin evento no hay notificación; fetch fallido no notifica
 *   (el componente conserva lo último en silencio).
 * - Notificar jamás bloquea: todo lo que toca red/DOM va en try/catch y los
 *   parsers nunca lanzan (respuesta ausente/corrupta → lista vacía + flags
 *   default true).
 * - Cotas (Regla 7): polling fijo 5s (`POLL_MS`); set de ids toasteados con
 *   cap 200 y evicción de los más viejos (`TOASTED_IDS_CAP`).
 * - Interruptores (Regla 8): ambos flags respetados (`shouldToast` exige
 *   `osNotifications:true`; centro apagado → mensaje, no error).
 *
 * Decisión del toast (main vs renderer): RENDERER con
 * `new Notification(title, { body })` + `Notification.requestPermission()`
 * best-effort. Por qué no `electron/main.ts`: no existe ningún canal
 * renderer→main viable para notificaciones (el preload no expone API de
 * toast y `main.ts` no tiene handler del tema); crearlo sería un canal IPC
 * nuevo + exponerlo en el preload sandboxed + lógica de foco/ventana en el
 * main, es decir exactamente el "refactor grande / canal IPC complejo"
 * prohibido para esta ola. Además el polling vive en el renderer por
 * contrato (1 solo intervalo) y el gate de foco (`document.hasFocus()`)
 * solo existe en el renderer. El "no molestar" del SO lo maneja
 * Chromium/Electron solo (las `Notification` de renderer pasan por el
 * centro de notificaciones del SO, que las suprime en modo no-molestar):
 * no se implementa nada al respecto, solo se documenta acá.
 *
 * ESM puro, TypeScript estricto, cero `require()`.
 */

// ---------------------------------------------------------------------------
// Cotas y constantes (Regla 7: número en código + test que lo demuestra)
// ---------------------------------------------------------------------------

/** Polling fijo del centro de notificaciones (contrato E2, testeado). */
export const POLL_MS = 5000;

/**
 * Cap del set de ids ya toasteados (dedupe: toast 1 por evento como máximo).
 * Al llegar, se borran los más viejos primero (Regla 7, testeado).
 */
export const TOASTED_IDS_CAP = 200;

/** Cap visual del body en el panel (el texto completo queda en `title`). */
export const NOTIFICATION_BODY_PREVIEW_MAX = 280;

// ---------------------------------------------------------------------------
// Tipos locales mínimos (espejo estructural del contrato E1, sinAutoresolver dependencias)
// ---------------------------------------------------------------------------

export interface UiNotification {
  id: string;
  /** Vocabulario E1 (`ask_human`, `spec-approval`, …); string abierto para no romper ante kinds aditivos futuros. */
  kind: string;
  workItemId?: string;
  title: string;
  body: string;
  at: string;
  acked: boolean;
}

export interface NotificationsResponse {
  notifications: UiNotification[];
  notificationsEnabled: boolean;
  osNotifications: boolean;
}

/** Fetch inyectable (los tests pasan mocks; el componente pasa el global). */
export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// ---------------------------------------------------------------------------
// URLs (sin puertos hardcodeados: el port siempre viene de discovery)
// ---------------------------------------------------------------------------

export function notificationsUrl(port: number): string {
  try {
    return `http://127.0.0.1:${port}/factory/notifications`;
  } catch {
    return "http://127.0.0.1:17680/factory/notifications";
  }
}

export function notificationAckUrl(port: number, id: string): string {
  try {
    return `http://127.0.0.1:${port}/factory/notifications/${encodeURIComponent(id)}/ack`;
  } catch {
    return "http://127.0.0.1:17680/factory/notifications/ack";
  }
}

// ---------------------------------------------------------------------------
// Parsers defensivos (nunca lanzan; lo desconocido → vacío/defaults)
// ---------------------------------------------------------------------------

function asNonEmptyString(v: unknown): string | null {
  try {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function parseOneNotification(v: unknown): UiNotification | null {
  try {
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    const id = asNonEmptyString(r.id);
    const title = asNonEmptyString(r.title);
    const body = asNonEmptyString(r.body);
    const kind = asNonEmptyString(r.kind);
    if (id === null || title === null || body === null || kind === null) return null;
    const at = typeof r.at === "string" && r.at.length > 0 ? r.at : "";
    const workItemId =
      typeof r.workItemId === "string" && r.workItemId.trim().length > 0
        ? r.workItemId.trim()
        : undefined;
    const out: UiNotification = {
      id: id.trim(),
      kind: kind.trim(),
      title,
      body,
      at,
      acked: r.acked === true,
    };
    if (workItemId !== undefined) out.workItemId = workItemId;
    return out;
  } catch {
    return null;
  }
}

/**
 * Parsea el GET con tipado estructural (`unknown` + optional chaining, sin
 * importar tipos del backend). Respuesta ausente/corrupta → lista vacía +
 * flags default true, sin throw. Nunca lanza.
 */
export function parseNotificationsResponse(input: unknown): NotificationsResponse {
  try {
    if (!input || typeof input !== "object") {
      return { notifications: [], notificationsEnabled: true, osNotifications: true };
    }
    const r = input as Record<string, unknown>;
    const raw = (r as { notifications?: unknown }).notifications;
    const notifications: UiNotification[] = [];
    try {
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const parsed = parseOneNotification(item);
          if (parsed) notifications.push(parsed);
        }
      }
    } catch {
      // parcial best-effort
    }
    let enabled = true;
    try {
      enabled = (r as { notificationsEnabled?: unknown }).notificationsEnabled !== false;
    } catch {
      enabled = true;
    }
    let os = true;
    try {
      os = (r as { osNotifications?: unknown }).osNotifications !== false;
    } catch {
      os = true;
    }
    return { notifications, notificationsEnabled: enabled, osNotifications: os };
  } catch {
    return { notifications: [], notificationsEnabled: true, osNotifications: true };
  }
}

// ---------------------------------------------------------------------------
// Lógica pura de UI (badge, ack optimista, toast, dedupe)
// ---------------------------------------------------------------------------

/** Contador de la campana = no-ackeadas. Entrada corrupta → 0. Nunca lanza. */
export function countUnacked(input: unknown): number {
  try {
    if (!Array.isArray(input)) return 0;
    let n = 0;
    for (const item of input) {
      try {
        if (item && typeof item === "object" && (item as { acked?: unknown }).acked !== true) {
          n += 1;
        }
      } catch {
        // item roto: se ignora sin romper el conteo
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * Refresh local optimista: marca `id` como acked SIN esperar el poll ni el
 * POST (el POST corre en paralelo best-effort). Puro (no muta la entrada);
 * id desconocido → copia igual. Nunca lanza.
 */
export function applyOptimisticAck(
  list: UiNotification[] | null | undefined,
  id: string,
): UiNotification[] {
  try {
    if (!Array.isArray(list)) return [];
    const key = typeof id === "string" ? id.trim() : "";
    return list.map((n) => {
      try {
        if (!n || typeof n !== "object") return n;
        if (key.length > 0 && n.id === key && n.acked !== true) {
          return { ...n, acked: true };
        }
        return { ...n };
      } catch {
        return n;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Gate del toast OS. `true` solo si TODO se cumple: flag `osNotifications`
 * true + ventana SIN foco + id no visto + notificación no-ackeada.
 * Cualquier otra combinación → false. Nunca lanza.
 */
export function shouldToast(args: {
  osNotifications: unknown;
  documentFocused: unknown;
  seenIds: Set<string> | ReadonlySet<string> | null | undefined;
  notification: { id?: unknown; acked?: unknown } | null | undefined;
}): boolean {
  try {
    if (!args || typeof args !== "object") return false;
    if (args.osNotifications !== true) return false;
    if (args.documentFocused !== false) return false;
    const n = args.notification;
    if (!n || typeof n !== "object") return false;
    if (n.acked === true) return false;
    if (typeof n.id !== "string" || n.id.trim().length === 0) return false;
    try {
      if (args.seenIds && typeof (args.seenIds as ReadonlySet<string>).has === "function") {
        if ((args.seenIds as ReadonlySet<string>).has(n.id)) return false;
      }
    } catch {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Candidatas a toast: no-ackeadas y no-vistas (no evalúa foco ni flags; eso
 * lo decide `shouldToast` por candidata). Entrada corrupta → []. Nunca lanza.
 */
export function collectToastable(
  list: UiNotification[] | null | undefined,
  seenIds: Set<string> | ReadonlySet<string> | null | undefined,
): UiNotification[] {
  try {
    if (!Array.isArray(list)) return [];
    const out: UiNotification[] = [];
    for (const n of list) {
      try {
        if (!n || typeof n !== "object") continue;
        if (n.acked === true) continue;
        if (typeof n.id !== "string" || n.id.trim().length === 0) continue;
        let seen = false;
        try {
          seen =
            !!seenIds &&
            typeof (seenIds as ReadonlySet<string>).has === "function" &&
            (seenIds as ReadonlySet<string>).has(n.id);
        } catch {
          seen = false;
        }
        if (!seen) out.push(n);
      } catch {
        // item roto: se omite
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Evicción del set de toasteados a `TOASTED_IDS_CAP` (borra los más viejos
 * primero: `Set` itera en inserción). Opera in-place y devuelve el mismo set.
 * Nunca lanza.
 */
export function pruneToastedIds(seen: Set<string>): Set<string> {
  try {
    if (!seen || typeof seen.size !== "number") return seen;
    try {
      while (seen.size > TOASTED_IDS_CAP) {
        const oldest = seen.values().next();
        if (oldest.done) break;
        try {
          seen.delete(oldest.value as string);
        } catch {
          break;
        }
      }
    } catch {
      // best-effort
    }
    return seen;
  } catch {
    try {
      return seen;
    } catch {
      return new Set<string>();
    }
  }
}

/**
 * Registra un id toasteado (dedupe: toast 1 por evento) + evicción a cap 200.
 * Id inválido → no-op. Nunca lanza.
 */
export function addToastedId(seen: Set<string>, id: string): Set<string> {
  try {
    if (!seen || typeof seen.add !== "function") return seen;
    try {
      if (typeof id === "string" && id.trim().length > 0) {
        seen.add(id);
      }
    } catch {
      // noop
    }
    return pruneToastedIds(seen);
  } catch {
    try {
      return seen;
    } catch {
      return new Set<string>();
    }
  }
}

/** Fecha `at` en formato local. Inválida/ausente → "—". Nunca lanza. */
export function formatNotificationDate(at: unknown): string {
  try {
    if (typeof at !== "string" || at.trim().length === 0) return "—";
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Red con fetch inyectado (tests usan mocks; jamás red real en tests)
// ---------------------------------------------------------------------------

/**
 * GET del centro. Propaga el fallo de red o `!ok` (el componente lo silencia
 * y conserva lo último: fetch fallido no notifica, cero spam). El JSON
 * corrupto NO lanza (parse tolerante). Solo lanza ante red/HTTP.
 */
export async function fetchNotifications(
  fetchFn: FetchLike,
  port: number,
): Promise<NotificationsResponse> {
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetchFn(notificationsUrl(port));
  } catch (e) {
    throw new Error(`GET /factory/notifications falló: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res || res.ok !== true) {
    const status = res && typeof res.status === "number" ? res.status : -1;
    throw new Error(`GET /factory/notifications → ${status}`);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return parseNotificationsResponse(data);
}

/**
 * POST ack best-effort. Nunca lanza: `true` si el server confirmó, `false`
 * ante 404/red/cualquier fallo (el ack optimista local ya vale; el próximo
 * poll reconcilia).
 */
export async function ackNotificationById(
  fetchFn: FetchLike,
  port: number,
  id: string,
): Promise<boolean> {
  try {
    if (typeof id !== "string" || id.trim().length === 0) return false;
    let res: { ok: boolean; status: number; json(): Promise<unknown> } | null = null;
    try {
      res = await fetchFn(notificationAckUrl(port, id.trim()), { method: "POST" });
    } catch {
      return false;
    }
    return !!res && res.ok === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Foco + toast OS en renderer (best-effort; jamás rompe la app)
// ---------------------------------------------------------------------------

/**
 * `true` si el documento tiene foco (ventana con foco → solo badge, sin
 * toast). Ante cualquier duda (sin DOM, SSR, excepción) devuelve `true`
 * (fail-safe silencioso: prefiere NO toastear). Nunca lanza.
 */
export function isDocumentFocused(): boolean {
  try {
    const doc = (globalThis as unknown as { document?: unknown }).document as
      | { hasFocus?: unknown }
      | undefined;
    if (!doc || typeof doc.hasFocus !== "function") return true;
    try {
      return (doc.hasFocus as () => unknown)() !== false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

/**
 * Toast OS en el renderer (`new Notification` tras
 * `Notification.requestPermission()` best-effort). Todo en try/catch: si el
 * permiso falla o no hay API → `false` (solo badge), jamás rompe la app.
 * El "no molestar" del SO lo aplica Chromium/Electron solo. Nunca lanza.
 */
export async function fireOsToastBestEffort(title: string, body: string): Promise<boolean> {
  try {
    const g = globalThis as unknown as {
      window?: unknown;
      Notification?: unknown;
    };
    if (typeof g.window === "undefined" && typeof g.Notification === "undefined") {
      return false;
    }
    const NCtor = g.Notification as
      | (new (title: string, opts?: { body?: string }) => unknown)
      | undefined;
    if (typeof NCtor === "undefined" || NCtor === null) return false;
    const t = typeof title === "string" && title.trim().length > 0 ? title : "TermCanvas";
    const b = typeof body === "string" ? body : "";
    try {
      const perm = (NCtor as unknown as { permission?: unknown }).permission;
      if (perm !== "granted") {
        try {
          const req = (NCtor as unknown as { requestPermission?: unknown }).requestPermission;
          if (typeof req === "function") {
            const out = (req as () => unknown)();
            const settled = out && typeof (out as PromiseLike<unknown>).then === "function"
              ? await (out as Promise<string>).catch(() => "denied")
              : out;
            if (settled !== "granted") return false;
          } else {
            return false;
          }
        } catch {
          return false;
        }
      }
    } catch {
      return false;
    }
    try {
      void new NCtor(t, { body: b });
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
