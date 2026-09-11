/**
 * factory/notifications/notificationRoutes — FASE 3 E2: dominio notifications.
 *
 * Dueno E2 en FASE 3 (apartado 2 + apartado 3 + apartado 4 de
 * docs/MASTER-PLAN-MODULARIDAD.md): este modulo es la puerta del cascaron
 * (`factoryServer.ts`, bloque Rutas notifications) hacia el centro de
 * notificaciones: parsers puros + listado con flags + ack por id. El server
 * conserva formas y handlers y respuestas; solo el MATCH, los guards y la
 * lectura delegan. El bloque Rutas measure de E1 queda intacto.
 *
 * Reglas que honra (las 8 de los master plans + C1-C10):
 * - C1 ESM y cotas: ESM puro, cero llamadas dinamicas con cadena,
 *   sin temporizadores nuevos, sin recorridos escritos a mano: solo
 *   composicion de llamadas acotadas sobre el store (el anillo 100 vive en
 *   el dueno `notify/notifications`, nunca crece sin cota).
 * - C2 puras fail-safe: cada export con try y catch; ante cualquier
 *   imprevisto retorna vacio o marca de error, nunca lanza hacia el server.
 * - C3 un escritor: este modulo SOLO LEE el centro (`listNotifications`) y
 *   marca ack via `ackNotification` (dueno del archivo `.notifications.json`
 *   mas evento). Jamas escribe job.json, result.json ni verify.json, jamas
 *   transiciona estados.
 * - C4 disco best-effort: heredado del dueno del store (tmp y rename,
 *   restore tolerante: ausente o corrupto equivale a lista vacia).
 * - C5 aditivo: codigos, textos y formas identicos a los handlers actuales
 *   (pacts F01-F14, thresholds, sampling, polling y flags intactos; centro
 *   apagado equivale a GET con lista vacia pero el store NO borra).
 * - C6 y C7 vocabulario unico, nada duplicado: parsers y guards viven ACA
 *   y el cascaron los re-exporta por identidad (el server no redefine;
 *   la paridad se demuestra en tests con igualdad de referencias).
 * - C8 rutas en tabla: cubre notifications-list y notifications-ack de
 *   `factory/routing/routeTable.ts` (globales, sin alias dual).
 * - C9 builders puros testeables: el payload del GET es funcion pura del
 *   store mas flags, testeable sin server vivo.
 * - C10 trazabilidad: cada helper cita su bloque espejo del cascaron.
 *
 * Lista blanca de imports (reparto FASE 3 E2): notify/notifications
 * (SOLO lectura mas ack: `listNotifications`, `ackNotification`,
 * `isNotificationsEnabled`, `isOsNotificationsEnabled`).
 * PROHIBIDO: review, triage, spec, measure, runner-executor y sus stores,
 * agentLoader, definitionValidate, VerificationPanel, package.json.
 */

import {
  ackNotification,
  isNotificationsEnabled,
  isOsNotificationsEnabled,
  listNotifications,
} from "../../notify/notifications";
import type { FactoryNotification } from "../../notify/notifications";

/** Longitud maxima de un id en ruta (espejo de los parsers existentes; cota C1). */
const MAX_NOTIFICATION_ROUTE_ID_LEN = 128;

/** Ids que nunca son una notificacion en rutas (defensa estructural). */
const NOTIFICATION_RESERVED_IDS: ReadonlySet<string> = new Set([
  "notifications",
  "ack",
]);

/**
 * True si un id es seguro para match. Espejo documentado del helper de ids
 * seguros del cascaron (ver C7 en el header): rechaza vacio, `.`, `..`,
 * cualquier `..`, `/`, `\`, NUL y reservados, mas traversal codificado.
 * Puro, nunca lanza.
 */
function isSafeNotificationId(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > MAX_NOTIFICATION_ROUTE_ID_LEN) return false;
    if (id.trim().length === 0) return false;
    if (id === "." || id === "..") return false;
    if (id.includes("..")) return false;
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
    if (NOTIFICATION_RESERVED_IDS.has(id)) return false;
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) {
        if (decoded.includes("..")) return false;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return false;
        if (decoded === "." || decoded === "..") return false;
        if (NOTIFICATION_RESERVED_IDS.has(decoded)) return false;
      }
    } catch {
      if (id.includes("%")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type NotificationAckPathOk = { id: string };
export type NotificationAckPathErr = { error: string };

/**
 * Parsea el pathname de POST /factory/notifications/:id/ack (espejo del
 * bloque Ola 19 del cascaron). Longitud exacta 4
 * ["factory","notifications",":id","ack"], rechaza traversal. Nunca lanza.
 */
export function parseNotificationAckPath(
  pathname: unknown,
): NotificationAckPathOk | NotificationAckPathErr {
  try {
    if (typeof pathname !== "string") return { error: "invalid pathname" };
    if (!pathname.startsWith("/factory/notifications/")) return { error: "not notifications-ack route" };
    if (!pathname.endsWith("/ack")) return { error: "not notifications-ack route" };
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length !== 4) return { error: "unexpected path length for notifications ack" };
    if (parts[0] !== "factory" || parts[1] !== "notifications" || parts[3] !== "ack") {
      return { error: "not notifications-ack route" };
    }
    const id = parts[2];
    if (!id || id === "notifications" || id === "ack") {
      return { error: "missing id for notifications ack" };
    }
    if (!isSafeNotificationId(id)) {
      return { error: `invalid id: ${String(id).slice(0, 60)}` };
    }
    return { id };
  } catch {
    return { error: "invalid pathname" };
  }
}

/**
 * True para GET /factory/notifications (espejo del bloque Ola 19 del
 * cascaron). Puro, nunca lanza.
 */
export function isNotificationsListRoute(method: unknown, pathname: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/notifications";
  } catch {
    return false;
  }
}

export interface NotificationsResponse {
  notifications: FactoryNotification[];
  notificationsEnabled: boolean;
  osNotifications: boolean;
}

/**
 * Payload de GET /factory/notifications (espejo del bloque Ola 19 del
 * cascaron). Cuando el centro esta apagado retorna lista vacia mas flags
 * (el store NO borra). Nunca lanza.
 */
export function buildNotificationsResponse(): NotificationsResponse {
  try {
    let enabled = true;
    let osEnabled = true;
    try {
      enabled = isNotificationsEnabled();
    } catch {
      enabled = true;
    }
    try {
      osEnabled = isOsNotificationsEnabled();
    } catch {
      osEnabled = true;
    }
    if (!enabled) {
      return { notifications: [], notificationsEnabled: enabled, osNotifications: osEnabled };
    }
    try {
      return { notifications: listNotifications(), notificationsEnabled: enabled, osNotifications: osEnabled };
    } catch {
      return { notifications: [], notificationsEnabled: enabled, osNotifications: osEnabled };
    }
  } catch {
    return { notifications: [], notificationsEnabled: true, osNotifications: true };
  }
}

export type AckNotificationResult =
  | { ok: true; notification: FactoryNotification | null }
  | { ok: false; error: string };

/**
 * Marca ack por id y devuelve la notificacion actualizada (espejo del bloque
 * POST /factory/notifications/:id/ack del cascaron: 404 honesto si no existe,
 * 200 con `{ok, notification}` si existe). Nunca lanza.
 */
export function ackNotificationById(id: unknown): AckNotificationResult {
  try {
    if (typeof id !== "string" || id.trim().length === 0) {
      return { ok: false, error: "notification not found" };
    }
    if (!isSafeNotificationId(id)) {
      return { ok: false, error: "notification not found" };
    }
    let done = false;
    try {
      done = ackNotification(id);
    } catch {
      done = false;
    }
    if (!done) return { ok: false, error: "notification not found" };
    try {
      const found = listNotifications().find((n) => n.id === id) ?? null;
      return { ok: true, notification: found };
    } catch {
      return { ok: true, notification: null };
    }
  } catch {
    return { ok: false, error: "notification not found" };
  }
}
