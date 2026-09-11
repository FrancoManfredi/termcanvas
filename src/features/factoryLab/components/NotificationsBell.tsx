/**
 * NotificationsBell — Ola 19 E2 (Paridad Warp: notificaciones locales, lado UI).
 *
 * F4-E2 (vista única, docs/MASTER-PLAN-MODULARIDAD.md §2 FASE 4, punto 1):
 * panel prueba migrado al único importador de red del renderer
 * (`src/lib/factoryClient.ts`: `listFactoryNotifications` +
 * `postFactoryNotificationAck`, que nunca lanzan). La lógica pura (badge, ack
 * optimista, toast, dedupe) sigue en `./notificationsUi.ts` y el parse
 * tolerante adapta la respuesta del cliente; el tick (un solo intervalo de
 * 5s con cleanup), las formas y los textos quedan intactos. Criterio de
 * elección (el que menos duele): superficie mínima (2 ops, sin POST con body)
 * y un solo intervalo; el resto de paneles queda con TODO carry-over
 * (ver `tests/no-direct-fetch.test.ts`).
 *
 * Campana con contador de no-ackeadas + panel. Contrato E1 (solo se consume):
 * `GET /factory/notifications` / `POST /:id/ack` + flags `notificationsEnabled`
 * (centro) y `osNotifications` (toast). La lógica pura vive en
 * `./notificationsUi.ts` (testeable sin React/DOM); este archivo solo orquesta
 * polling + render + toast best-effort.
 *
 * - Polling fijo `POLL_MS = 5000` (re-exportado para tests): UN solo
 *   `setInterval` con cleanup, ningún otro intervalo en este archivo.
 * - Cada poll: GET; si `notificationsEnabled:false` → muestra
 *   "notificaciones apagadas" (sin error); si el fetch falla → silencioso
 *   (conserva lo último, cero spam, cero throw).
 * - Cada fila: kind (badge textual), title, body (cap visual, completo en
 *   `title`), fecha `at`, link al job si hay `workItemId`, botón Ack → POST
 *   ack + refresh local optimista (marca acked sin esperar el poll).
 * - Toast OS (decisión documentada en `notificationsUi.ts`): el renderer
 *   detecta notificaciones NUEVAS no-ackeadas no-vistas y dispara
 *   `new Notification` solo si `osNotifications:true` del GET +
 *   `document.hasFocus()===false` (ventana con foco → solo badge, sin toast).
 *   Dedupe con `Set` de ids toasteados con cap 200 y evicción de los más
 *   viejos. Todo best-effort en try/catch: notificar jamás bloquea ni rompe.
 *
 * H-003 (E2): causa del corte hallada por lectura — el panel era `absolute`
 *   dentro de DOS ancestros con `overflow-hidden` (`src/App.tsx`: root
 *   `h-screen w-screen overflow-hidden` + main `fixed ... overflow-hidden`
 *   del Factory Lab): todo `absolute` que exceda esas cajas se recorta a
 *   mitad de pantalla, y el diálogo no tenía `max-height` propio (solo el
 *   `ul` interno) ni ancho responsive (fijo 320px, justo en viewport 375px).
  *   Fix: diálogo `fixed` posicionado por rect del botón (ya no depende del
  *   overflow de ningún padre) + `max-h-[min(70vh,400px)]` con scroll +
  *   `z-[100]` (por encima del toolbar z-50 y SessionsPanel z-[80]) +
  *   `w-[320px]` con `max-w-[min(320px,calc(100vw-16px))]` para 375px.
  *   Reapertura corrida 2 (E2E-11 FAIL): el anclaje por `right` dejaba
  *   `left = rect.right - 320 < 0` con la campana en x≈167 (clip izquierdo
  *   medido x=-130 @1280px, x=-175 @375px). Ahora se ancla por `left`
  *   clampeado (`max(rect.right - width, 8)`) + flip vertical si se pasa por
  *   abajo. Cero polling nuevo: el
  *   reposicionado usa listeners pasivos scroll/resize con cleanup; los datos
  *   siguen viniendo del tick existente de 5s.
 *
 * ESM puro, cero `require()`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
// F4-E2: red vía el único importador del renderer (sin acceso directo nuevo).
import {
  listFactoryNotifications,
  postFactoryNotificationAck,
} from "@/lib/factoryClient";
import {
  NOTIFICATION_BODY_PREVIEW_MAX,
  addToastedId,
  applyOptimisticAck,
  collectToastable,
  countUnacked,
  fireOsToastBestEffort,
  formatNotificationDate,
  isDocumentFocused,
  parseNotificationsResponse,
  shouldToast,
} from "./notificationsUi";
import type { UiNotification } from "./notificationsUi";

export { POLL_MS, TOASTED_IDS_CAP } from "./notificationsUi";
import { POLL_MS } from "./notificationsUi";

/**
 * H-003 reapertura: constantes del panel espejadas entre el cálculo JS de
 * `place()` y el className del diálogo. `PANEL_WIDTH_PX` debe matchear
 * `w-[320px]`; `PANEL_MARGIN_PX` es el aire mínimo a los bordes del viewport
 * (8px, espejado en `max-w-[min(320px,calc(100vw-16px))]`).
 */
const PANEL_WIDTH_PX = 320;
const PANEL_MARGIN_PX = 8;

function warnBestEffort(message: string, detail: unknown): void {
  try {
    const suffix = detail instanceof Error ? detail.message : String(detail);
    console.warn(`[NotificationsBell] ${message} ${suffix}`.slice(0, 300));
  } catch {
    // warn jamás rompe
  }
}

function BellIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v2.6L2 10.5h12l-1.5-1.9V6A4.5 4.5 0 0 0 8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 13a1.7 1.7 0 0 0 3.2 0"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NotificationsPanel(props: {
  enabled: boolean;
  notifications: UiNotification[];
  onAck: (id: string) => void;
}): React.JSX.Element {
  const { enabled, notifications, onAck } = props;
  if (!enabled) {
    return (
      <p className="px-3 py-4 text-center text-[11px] text-zinc-500" aria-live="polite">
        notificaciones apagadas
      </p>
    );
  }
  if (notifications.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-[11px] text-zinc-500" aria-live="polite">
        Sin notificaciones
      </p>
    );
  }
  return (
    <ul className="max-h-[320px] divide-y divide-zinc-100 overflow-auto">
      {notifications.map((n) => (
        <li key={n.id} className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-50 px-1.5 py-px font-mono text-[10px] text-zinc-600">
              {n.kind}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-900" title={n.title}>
              {n.title}
            </span>
            {!n.acked ? (
              <button
                type="button"
                onClick={() => onAck(n.id)}
                aria-label={`Marcar como leída: ${n.title}`}
                className="shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-px text-[10px] font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
              >
                Ack
              </button>
            ) : null}
          </div>
          <p
            className="mt-1 text-[11px] leading-snug text-zinc-600"
            title={n.body}
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {n.body.length > NOTIFICATION_BODY_PREVIEW_MAX
              ? `${n.body.slice(0, NOTIFICATION_BODY_PREVIEW_MAX)}…`
              : n.body}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
            <time dateTime={n.at || undefined}>{formatNotificationDate(n.at)}</time>
            {n.workItemId ? (
              <a
                href={`#job-${encodeURIComponent(n.workItemId)}`}
                title={`Ver job ${n.workItemId}`}
                className="font-mono text-zinc-500 underline decoration-dotted hover:text-zinc-700"
              >
                job {n.workItemId}
              </a>
            ) : null}
            {n.acked ? <span aria-label="leída">leída</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NotificationsBell(): React.JSX.Element {
  const [notifications, setNotifications] = useState<UiNotification[]>([]);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [open, setOpen] = useState<boolean>(false);
  const toastedIdsRef = useRef<Set<string>>(new Set());
  // H-003: ancla viewport del panel `fixed` (independiente del overflow paterno).
  // Reapertura corrida 2 (E2E-11 FAIL): anclar por `right` alineaba el borde
  // derecho del panel (320px) al borde derecho de la campana (x≈167), dejando
  // `left < 0` → clip izquierdo. Se ancla por `left` clampeado con 8px de
  // margen + flip vertical si el panel se pasa por abajo.
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick(): Promise<void> {
      let parsed: ReturnType<typeof parseNotificationsResponse> | null = null;
      try {
        const port = await discoverFactoryPort();
        if (port === null || cancelled) return;
        // F4-E2: GET vía el único cliente del renderer (nunca lanza: ante
        // red caída, HTTP !ok o forma inesperada retorna fallback con ok:false).
        const res = await listFactoryNotifications({ port });
        if (!res.ok && (res.status === null || res.status < 200 || res.status > 299)) {
          // Red caída o HTTP !ok → silencioso: conserva lo último, cero spam.
          return;
        }
        // 200 con o sin forma esperada: el parser tolerante devuelve lista
        // vacía + flags default ante 200 corrupto (mismo clear honesto que el
        // GET anterior; jamás lanza).
        parsed = parseNotificationsResponse(res.data);
      } catch {
        // Fetch fallido → silencioso: conserva lo último, cero spam, cero throw.
        return;
      }
      if (cancelled || parsed === null) return;
      if (parsed.notificationsEnabled === false) {
        // Centro apagado → mensaje, no error (Regla 8).
        setEnabled(false);
        setNotifications([]);
        return;
      }
      setEnabled(true);
      setNotifications(parsed.notifications);
      // Toast OS: NUEVAS no-ackeadas no-vistas, solo sin foco y con flag.
      try {
        const focused = isDocumentFocused();
        const candidates = collectToastable(parsed.notifications, toastedIdsRef.current);
        for (const n of candidates) {
          let fire = false;
          try {
            fire = shouldToast({
              osNotifications: parsed.osNotifications,
              documentFocused: focused,
              seenIds: toastedIdsRef.current,
              notification: n,
            });
          } catch {
            fire = false;
          }
          // Dedupe at-most-once: el id se marca visto se dispare o no el
          // toast (con foco o con flag apagado → solo badge, sin reintento
          // ruidoso en el próximo poll).
          try {
            addToastedId(toastedIdsRef.current, n.id);
          } catch {
            // noop
          }
          if (!fire) continue;
          try {
            void fireOsToastBestEffort(n.title, n.body).catch(() => false);
          } catch {
            // el toast jamás bloquea el flujo
          }
        }
      } catch {
        // el toast jamás bloquea el flujo
      }
    }

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // H-003: posiciona el panel `fixed` bajo la campana y lo mantiene anclado
  // en scroll/resize (listeners pasivos con cleanup, cero intervalos nuevos;
  // los datos siguen viniendo del tick de 5s de arriba).
  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    if (typeof window === "undefined") return;
    const place = (): void => {
      try {
        const rect = btnRef.current?.getBoundingClientRect();
        if (!rect) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Ancho efectivo espejado del CSS: nunca excede el viewport.
        const width = Math.min(PANEL_WIDTH_PX, Math.max(0, vw - PANEL_MARGIN_PX * 2));
        // Clamp izquierdo: el panel nunca sale por la izquierda (8px de aire).
        const left = Math.max(PANEL_MARGIN_PX, Math.round(rect.right - width));
        // Clamp superior análogo + flip: si abajo no entra y arriba sí, abre
        // hacia arriba (maxH espeja max-h-[min(70vh,400px)] del diálogo).
        const maxH = Math.min(vh * 0.7, 400);
        let top = Math.max(PANEL_MARGIN_PX, Math.round(rect.bottom + PANEL_MARGIN_PX));
        if (top + maxH > vh - PANEL_MARGIN_PX && rect.top - maxH - PANEL_MARGIN_PX >= PANEL_MARGIN_PX) {
          top = Math.round(rect.top - maxH - PANEL_MARGIN_PX);
        }
        setAnchor({ top, left });
      } catch {
        // best-effort: sin ancla el panel no se muestra, sin romper
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const handleAck = useCallback((id: string) => {
    // Refresh local optimista: marca acked sin esperar el poll.
    setNotifications((prev) => {
      try {
        return applyOptimisticAck(prev, id);
      } catch {
        return prev;
      }
    });
    void (async () => {
      try {
        const port = await discoverFactoryPort();
        if (port === null) return;
        let ok = false;
        try {
          // F4-E2: ack vía el único cliente del renderer (best-effort, nunca lanza).
          const ackRes = await postFactoryNotificationAck(id, { port });
          ok = ackRes.ok === true && ackRes.data.acked === true;
        } catch (e) {
          warnBestEffort("ack best-effort falló:", e);
          return;
        }
        if (!ok) warnBestEffort("ack no confirmado por el server (404/red); se mantiene el optimista:", id);
      } catch (e) {
        warnBestEffort("ack best-effort falló:", e);
      }
    })();
  }, []);

  let unacked = 0;
  try {
    unacked = countUnacked(notifications);
  } catch {
    unacked = 0;
  }

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unacked > 0 ? `Notificaciones, ${unacked} sin leer` : "Notificaciones, sin pendientes"}
        aria-expanded={open}
        title="Notificaciones"
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
      >
        <BellIcon />
        {unacked > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 inline-flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
          >
            {unacked > 99 ? "99+" : String(unacked)}
          </span>
        ) : null}
      </button>
      {open && anchor ? (
        <div
          role="dialog"
          aria-label="Panel de notificaciones"
          className="fixed z-[100] max-h-[min(70vh,400px)] w-[320px] max-w-[min(320px,calc(100vw-16px))] overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg"
          style={{ top: anchor.top, left: anchor.left }}
        >
          <div className="border-b border-zinc-100 px-3 py-2 text-[11px] font-semibold text-zinc-700">
            Notificaciones
          </div>
          <NotificationsPanel enabled={enabled} notifications={notifications} onAck={handleAck} />
        </div>
      ) : null}
    </div>
  );
}

export default NotificationsBell;
