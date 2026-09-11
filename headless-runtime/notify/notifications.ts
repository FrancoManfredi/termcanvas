/**
 * Notifications — Ola 19 (Paridad Warp: centro de notificaciones locales).
 *
 * Centro persistido en app + base para toast OS (E2) y campana (polling 5s).
 * Eventos: `ask_human` (review), `spec-approval`, `proposal-ready`,
 * `benchmark-done`, `daemon-error` (opencode no disponible).
 *
 * Contratos vivos (solo aditivos, pacts F01–F14 intactos):
 * - `notify` nunca lanza (try/catch total, ante cualquier fallo retorna null
 *   sin romper al caller). Flag `notificationsEnabled:false` → no-op null
 *   (apagado total, Regla 8).
 * - Dedupe: si ya existe una NO-acked con mismo `dedupeKey` (cuando se pasa)
 *   o mismo `kind+workItemId+title+body` (cuando no), retorna la existente
 *   sin duplicar (toast 1 por evento sale de acá).
 * - Ring 100 (Regla 7): al exceder, se descarta la más vieja ACKED primero;
 *   si todas están sin ack, la más vieja igual (nunca crecer sin cota).
 * - Persistencia: `factory/.notifications.json` (array JSON, escritura
 *   atómica best-effort tmp→rename, restore tolerante: ausente/corrupto →
 *   lista vacía, nunca throw).
 * - `id`: `n-<epochMs>-<counter>` (counter en memoria, único por proceso).
 * - `at`: ISO string. `listNotifications` newest-first, cap `limit ?? 100`
 *   (limit > 100 se clampa a 100). `ackNotification` marca acked+persist
 *   best-effort, id inexistente → false.
 * - Fan-out D18 (aditivo): cada notificación REALMENTE creada se entrega en
 *   forma sincrónica best-effort a los created-listeners registrados
 *   (registro acotado a NOTIFICATION_LISTENERS_MAX, hits de dedupe y nulls
 *   no emiten). El centro no conoce a los suscriptores: el puente de
 *   automations vive en el dominio automations (cero imports nuevos acá,
 *   cero ciclos).
 * - Validación zod 4 (`z.object` + `superRefine`, sin `.refine` legacy):
 *   kind cerrado, title/body no-vacíos ≤500ch c/u (más largo → truncado
 *   honesto con `…`, no rechazo), workItemId opcional.
 *
 * Directorio base testeable: honra `process.env.TERMCANVAS_FACTORY_DIR`
 * (tests lo apuntan a un tmpdir; producción usa `<repo>/factory`). El archivo
 * siempre es `.notifications.json` bajo ese base (contrato
 * `factory/.notifications.json`).
 *
 * ESM puro, TypeScript estricto, cero require().
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getFactoryConfig } from "../factory/agentLoader";

// ── Tipos ──

export type NotificationKind =
  | "ask_human"
  | "spec-approval"
  | "proposal-ready"
  | "benchmark-done"
  | "daemon-error";

export interface FactoryNotification {
  id: string;
  kind: NotificationKind;
  workItemId?: string;
  title: string;
  body: string;
  at: string;
  acked: boolean;
}

export interface NotifyInput {
  kind: NotificationKind;
  workItemId?: string;
  title: string;
  body: string;
  dedupeKey?: string;
  /**
   * Marks a notification born from an automation trigger effect (the
   * automations domain sets it on its own trigger posts). It is NEVER
   * persisted and NEVER part of the GET envelope: it only travels to the
   * in-process created-listeners as loop-guard metadata (D18 event path).
   * Human-born notifications never carry it.
   */
  fromAutomation?: boolean;
}

/** Cota dura del ring (Regla 7: cero loops sin cota). */
export const NOTIFICATIONS_MAX = 100;

/**
 * Hard cap of the created-listener registry (D18 event path, Rule 7).
 * Fan-out is a single synchronous forEach over at most this many
 * subscribers (structural termination; LOOPS +0-note, no meta-test entry:
 * forEach never matches the loop patterns). Production holds exactly one
 * (the automations bridge); the cap only guards test leaks.
 */
export const NOTIFICATION_LISTENERS_MAX = 8;

/** Vocabulario cerrado de kinds (contrato E1↔E2). */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "ask_human",
  "spec-approval",
  "proposal-ready",
  "benchmark-done",
  "daemon-error",
] as const;

/** Cap de title/body (más largo → truncado honesto con `…`, no rechazo). */
export const NOTIFICATION_TEXT_MAX = 500;

/** Marca de truncado honesto (contrato). */
export const NOTIFICATION_TRUNCATION_MARK = "…";

// ── Created-listeners (D18 event path: notify → automations fireEvent) ──

/**
 * Side metadata handed to created-listeners alongside the stored copy.
 * Never persisted, never served over HTTP. `fromAutomation` is the
 * anti-loop guard: the automations bridge skips anything carrying it.
 */
export interface NotificationEmitMeta {
  readonly dedupeKey?: string;
  readonly fromAutomation?: boolean;
}

/**
 * Observer of newly CREATED notifications (dedupe hits and nulls never
 * fan out). Synchronous, best-effort: one throwing listener never breaks
 * notify nor the remaining listeners. Never throws by contract.
 */
export type NotificationCreatedListener = (
  notif: FactoryNotification,
  meta?: NotificationEmitMeta,
) => void;

const createdListeners: NotificationCreatedListener[] = [];

/**
 * Registers a created-listener. Idempotent (same fn twice keeps one slot)
 * and capped at NOTIFICATION_LISTENERS_MAX (fail-closed false beyond the
 * cap). Never throws.
 */
export function addNotificationCreatedListener(fn: NotificationCreatedListener): boolean {
  try {
    if (typeof fn !== "function") return false;
    if (createdListeners.includes(fn)) return true;
    if (createdListeners.length >= NOTIFICATION_LISTENERS_MAX) return false;
    createdListeners.push(fn);
    return true;
  } catch {
    return false;
  }
}

/** True while fn holds a registry slot. Never throws. */
export function hasNotificationCreatedListener(fn: NotificationCreatedListener): boolean {
  try {
    if (typeof fn !== "function") return false;
    return createdListeners.includes(fn);
  } catch {
    return false;
  }
}

/**
 * Releases one registry slot (false when absent). Never throws.
 * Tests use it to detach probes; the automations bridge detaches itself
 * via resetAutomationServiceForTests.
 */
export function removeNotificationCreatedListener(fn: NotificationCreatedListener): boolean {
  try {
    if (typeof fn !== "function") return false;
    const at = createdListeners.indexOf(fn);
    if (at < 0) return false;
    createdListeners.splice(at, 1);
    return true;
  } catch {
    return false;
  }
}

/** Live registry size (tests only). Never throws. */
export function getNotificationListenerCountForTests(): number {
  try {
    return createdListeners.length;
  } catch {
    return 0;
  }
}

/** Drops every registry slot (tests only; the daemon never calls it). */
export function clearNotificationListenersForTests(): void {
  try {
    createdListeners.length = 0;
  } catch {
    // noop
  }
}

// ── Interruptores (Regla 8) ──

let notificationsOverride: boolean | null = null;
let osNotificationsOverride: boolean | null = null;

export function setNotificationsOverrideForTests(v: boolean | null): void {
  try {
    notificationsOverride = v === null ? null : v === true;
  } catch {
    // noop
  }
}

export function resetNotificationsOverrideForTests(): void {
  try {
    notificationsOverride = null;
  } catch {
    // noop
  }
}

export function setOsNotificationsOverrideForTests(v: boolean | null): void {
  try {
    osNotificationsOverride = v === null ? null : v === true;
  } catch {
    // noop
  }
}

export function resetOsNotificationsOverrideForTests(): void {
  try {
    osNotificationsOverride = null;
  } catch {
    // noop
  }
}

/**
 * Flag `notificationsEnabled` de factory.yaml (default true). Apagado =
 * centro apagado total (`notify` no-op null; el GET filtra a `[]` pero el
 * store NO borra). Nunca lanza: ante cualquier fallo, default `true`.
 */
export function isNotificationsEnabled(): boolean {
  try {
    if (notificationsOverride !== null) return notificationsOverride;
    const cfg = getFactoryConfig() as { notificationsEnabled?: unknown } | null;
    return cfg?.notificationsEnabled !== false;
  } catch {
    return true;
  }
}

/**
 * Flag `osNotifications` de factory.yaml (default true). Apagado = sin toast
 * OS (el centro sigue guardando; solo E2 lo consulta). Nunca lanza.
 */
export function isOsNotificationsEnabled(): boolean {
  try {
    if (osNotificationsOverride !== null) return osNotificationsOverride;
    const cfg = getFactoryConfig() as { osNotifications?: unknown } | null;
    return cfg?.osNotifications !== false;
  } catch {
    return true;
  }
}

// ── Raíz factory testeable ──

function getRepoRoot(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(currentFile), "../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {
    // sigue a fallback por cwd
  }
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "headless-runtime"))
    ) {
      return cwd;
    }
  } catch {
    // sigue a cwd directo
  }
  return process.cwd();
}

function getFactoryBaseDir(): string {
  try {
    const env = process.env.TERMCANVAS_FACTORY_DIR;
    if (typeof env === "string" && env.trim().length > 0) {
      return path.resolve(env.trim());
    }
  } catch {
    // sigue a repo
  }
  try {
    return path.join(getRepoRoot(), "factory");
  } catch {
    return path.join(process.cwd(), "factory");
  }
}

function getNotificationsFilePath(): string {
  try {
    return path.join(getFactoryBaseDir(), ".notifications.json");
  } catch {
    return path.join(process.cwd(), "factory", ".notifications.json");
  }
}

// ── Store en memoria (oldest→newest) + dedupeKey interno ──

interface StoredEntry {
  notif: FactoryNotification;
  dedupeKey?: string;
}

let store: StoredEntry[] = [];
let counter = 0;
/** Ruta desde la que se cargó `store` (null = aún no cargado para el path actual). */
let loadedPath: string | null = null;

function truncateHonest(raw: string): string {
  try {
    const s = String(raw ?? "");
    if (s.length <= NOTIFICATION_TEXT_MAX) return s;
    return `${s.slice(0, NOTIFICATION_TEXT_MAX - 1)}${NOTIFICATION_TRUNCATION_MARK}`;
  } catch {
    return "";
  }
}

function ensureLoaded(): void {
  try {
    const current = getNotificationsFilePath();
    if (loadedPath === current) return;
    let next: StoredEntry[] = [];
    try {
      if (!fs.existsSync(current)) {
        store = [];
        loadedPath = current;
        return;
      }
      const raw = fs.readFileSync(current, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        store = [];
        loadedPath = current;
        return;
      }
      for (const item of parsed) {
        try {
          if (!item || typeof item !== "object") continue;
          const o = item as Record<string, unknown>;
          const id = typeof o.id === "string" ? o.id.trim() : "";
          const kindRaw = typeof o.kind === "string" ? o.kind.trim() : "";
          if (!id || !(NOTIFICATION_KINDS as readonly string[]).includes(kindRaw)) continue;
          const title = typeof o.title === "string" ? o.title : "";
          const body = typeof o.body === "string" ? o.body : "";
          if (!title || !body) continue;
          const at = typeof o.at === "string" && o.at.length > 0 ? o.at : new Date().toISOString();
          const acked = o.acked === true;
          const workItemId =
            typeof o.workItemId === "string" && o.workItemId.trim().length > 0
              ? o.workItemId.trim()
              : undefined;
          const dedupeKey =
            typeof o.dedupeKey === "string" && o.dedupeKey.trim().length > 0
              ? o.dedupeKey.trim()
              : undefined;
          const notif: FactoryNotification = {
            id,
            kind: kindRaw as NotificationKind,
            ...(workItemId ? { workItemId } : {}),
            title,
            body,
            at,
            acked,
          };
          next.push({ notif, ...(dedupeKey ? { dedupeKey } : {}) });
        } catch {
          // entrada rota: se omite
        }
      }
      // Cap dura ante archivo editado a mano con >100: conserva las 100 más nuevas.
      if (next.length > NOTIFICATIONS_MAX) {
        next = next.slice(-NOTIFICATIONS_MAX);
      }
      store = next;
      // El counter sigue único por proceso: salta al máximo visto para no
      // colisionar con ids restaurados en el mismo milisegundo.
      try {
        let maxSeen = counter;
        for (const e of store) {
          const m = /^n-\d+-(\d+)$/.exec(e.notif.id);
          if (m && m[1]) {
            const n = Number(m[1]);
            if (Number.isInteger(n) && n > maxSeen) maxSeen = n;
          }
        }
        counter = maxSeen;
      } catch {
        // noop
      }
      loadedPath = current;
    } catch {
      store = [];
      try {
        loadedPath = current;
      } catch {
        // noop
      }
    }
  } catch {
    // nunca lanza
  }
}

function persistBestEffort(): void {
  try {
    const target = getNotificationsFilePath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    } catch {
      // noop
    }
    const arr = store.map((e) => ({
      ...e.notif,
      ...(e.dedupeKey ? { dedupeKey: e.dedupeKey } : {}),
    }));
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), "utf-8");
    } catch {
      return;
    }
    try {
      fs.renameSync(tmp, target);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // noop
      }
      return;
    }
    try {
      loadedPath = target;
    } catch {
      // noop
    }
  } catch {
    // best-effort: persistir nunca rompe el flujo
  }
}

function copyNotif(n: FactoryNotification): FactoryNotification {
  try {
    return {
      id: n.id,
      kind: n.kind,
      ...(typeof n.workItemId === "string" && n.workItemId.length > 0
        ? { workItemId: n.workItemId }
        : {}),
      title: n.title,
      body: n.body,
      at: n.at,
      acked: n.acked,
    };
  } catch {
    return { ...n };
  }
}

// ── Validación zod 4 (`z.object` + `superRefine`, sin `.refine` legacy) ──

const NotifyInputSchema = z
  .object({
    kind: z.string(),
    workItemId: z.string().optional(),
    title: z.string(),
    body: z.string(),
    dedupeKey: z.string().optional(),
    fromAutomation: z.unknown().optional(),
  })
  .superRefine((d, ctx) => {
    const kind = typeof d.kind === "string" ? d.kind.trim() : "";
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) {
      ctx.addIssue({ code: "custom", message: `kind inválido "${String(d.kind).slice(0, 60)}"` });
    }
    const title = typeof d.title === "string" ? d.title.trim() : "";
    if (!title) {
      ctx.addIssue({ code: "custom", message: "title no puede estar vacío" });
    }
    const body = typeof d.body === "string" ? d.body.trim() : "";
    if (!body) {
      ctx.addIssue({ code: "custom", message: "body no puede estar vacío" });
    }
  });

// ── API ──

/**
 * Crea (o dedupea) una notificación. Nunca lanza: ante cualquier fallo
 * (validación, flag apagado, disco) retorna null sin romper al caller.
 * Flag `notificationsEnabled:false` → no-op null (apagado total).
 */
export function notify(input: NotifyInput): FactoryNotification | null {
  try {
    try {
      ensureLoaded();
    } catch {
      // sigue: el store en memoria vale igual
    }
    try {
      if (!isNotificationsEnabled()) return null;
    } catch {
      return null;
    }
    let parsed: z.infer<typeof NotifyInputSchema>;
    try {
      parsed = NotifyInputSchema.parse(input ?? {});
    } catch {
      return null;
    }
    const kind = (parsed.kind as string).trim() as NotificationKind;
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) return null;
    const titleRaw = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const bodyRaw = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!titleRaw || !bodyRaw) return null;
    const title = truncateHonest(titleRaw);
    const body = truncateHonest(bodyRaw);
    const workItemId =
      typeof parsed.workItemId === "string" && parsed.workItemId.trim().length > 0
        ? parsed.workItemId.trim()
        : undefined;
    const dedupeKey =
      typeof parsed.dedupeKey === "string" && parsed.dedupeKey.trim().length > 0
        ? parsed.dedupeKey.trim()
        : undefined;
    // Loop-guard metadata (D18): strict `=== true`, never persisted.
    const fromAutomation = parsed.fromAutomation === true;
    // Dedupe: solo contra NO-acked (una acked ya fue vista: un evento nuevo
    // igual merece re-notificar). `dedupeKey` manda cuando se pasa.
    try {
      if (dedupeKey) {
        for (const e of store) {
          if (!e.notif.acked && e.dedupeKey === dedupeKey) {
            return copyNotif(e.notif);
          }
        }
      } else {
        for (const e of store) {
          if (e.notif.acked) continue;
          if (e.notif.kind !== kind) continue;
          const sameWork =
            (e.notif.workItemId ?? undefined) === (workItemId ?? undefined);
          if (!sameWork) continue;
          if (e.notif.title !== title) continue;
          if (e.notif.body !== body) continue;
          return copyNotif(e.notif);
        }
      }
    } catch {
      // sigue a crear
    }
    counter += 1;
    const notif: FactoryNotification = {
      id: `n-${Date.now()}-${counter}`,
      kind,
      ...(workItemId ? { workItemId } : {}),
      title,
      body,
      at: new Date().toISOString(),
      acked: false,
    };
    const entry: StoredEntry = { notif, ...(dedupeKey ? { dedupeKey } : {}) };
    store.push(entry);
    // Ring 100 (Regla 7): descarta la más vieja ACKED primero; si todas
    // están sin ack, la más vieja igual. Nunca crecer sin cota.
    try {
      if (store.length > NOTIFICATIONS_MAX) {
        let ackedIdx = -1;
        for (let i = 0; i < store.length; i++) {
          if (store[i]?.notif.acked === true) {
            ackedIdx = i;
            break;
          }
        }
        if (ackedIdx >= 0) {
          store.splice(ackedIdx, 1);
        } else {
          store.splice(0, 1);
        }
      }
    } catch {
      try {
        while (store.length > NOTIFICATIONS_MAX) store.splice(0, 1);
      } catch {
        // noop
      }
    }
    try {
      persistBestEffort();
    } catch {
      // best-effort
    }
    // D18 event path: fan out ONLY on real creation (dedupe hits returned
    // above, nulls never reach here). Synchronous single forEach over a
    // capped registry (≤ NOTIFICATION_LISTENERS_MAX): structural
    // termination, zero timers, zero re-arms (LOOPS +0-note). Each listener
    // is isolated: a thrower never breaks notify nor its siblings.
    try {
      if (createdListeners.length > 0) {
        const meta: NotificationEmitMeta = {
          ...(dedupeKey ? { dedupeKey } : {}),
          ...(fromAutomation ? { fromAutomation: true as const } : {}),
        };
        const shared = copyNotif(notif);
        createdListeners.slice().forEach((cb) => {
          try {
            cb(shared, meta);
          } catch {
            // a listener never breaks notify
          }
        });
      }
    } catch {
      // fan-out never breaks notify
    }
    return copyNotif(notif);
  } catch {
    return null;
  }
}

/**
 * Últimas notificaciones, newest-first, cap `limit ?? 100` (limit > 100 se
 * clampa a 100). El store NO borra cuando el centro está apagado (el GET lo
 * filtra a `[]`); esta función devuelve lo guardado igual. Nunca lanza.
 */
export function listNotifications(limit?: number): FactoryNotification[] {
  try {
    try {
      ensureLoaded();
    } catch {
      // sigue con memoria
    }
    let cap = NOTIFICATIONS_MAX;
    try {
      if (limit === undefined || limit === null) {
        cap = NOTIFICATIONS_MAX;
      } else if (typeof limit !== "number" || !Number.isFinite(limit)) {
        cap = NOTIFICATIONS_MAX;
      } else {
        const floored = Math.floor(limit);
        if (floored <= 0) return [];
        cap = Math.min(floored, NOTIFICATIONS_MAX);
      }
    } catch {
      cap = NOTIFICATIONS_MAX;
    }
    const out: FactoryNotification[] = [];
    try {
      for (let i = store.length - 1; i >= 0 && out.length < cap; i--) {
        const e = store[i];
        if (!e || !e.notif) continue;
        out.push(copyNotif(e.notif));
      }
    } catch {
      // parcial best-effort
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Marca una notificación como acked + persiste best-effort.
 * Id inexistente → false. Nunca lanza.
 */
export function ackNotification(id: string): boolean {
  try {
    try {
      ensureLoaded();
    } catch {
      // sigue con memoria
    }
    if (typeof id !== "string" || id.trim().length === 0) return false;
    const key = id.trim();
    let found: StoredEntry | null = null;
    try {
      for (const e of store) {
        if (e?.notif?.id === key) {
          found = e;
          break;
        }
      }
    } catch {
      return false;
    }
    if (!found) return false;
    try {
      found.notif.acked = true;
    } catch {
      return false;
    }
    try {
      persistBestEffort();
    } catch {
      // best-effort: el ack en memoria ya vale
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Vacía la memoria (+ disco tmp en tests: borra el `.notifications.json`
 * del base actual best-effort), reinicia el counter y libera los
 * created-listeners (los puentes entre dominios se re-arman con su propio
 * ensure tras este reset). Solo para tests. Nunca lanza.
 */
export function resetNotificationsForTests(): void {
  try {
    store = [];
  } catch {
    // noop
  }
  try {
    counter = 0;
  } catch {
    // noop
  }
  try {
    const target = getNotificationsFilePath();
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // noop
    }
  } catch {
    // noop
  }
  try {
    loadedPath = null;
  } catch {
    // noop
  }
  try {
    createdListeners.length = 0;
  } catch {
    // noop
  }
}
