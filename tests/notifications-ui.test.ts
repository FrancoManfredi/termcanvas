/**
 * Ola 19 E2 — suite UI de notificaciones locales (lado UI + toast).
 * `npx tsx --test tests/notifications-ui.test.ts` (offline, sin daemon, sin
 * red real: el fetch siempre es un mock inyectado). No monta React/DOM: cubre
 * la lógica pura de `notificationsUi.ts` + guards estáticos del fuente de
 * `NotificationsBell.tsx` (1 solo intervalo, cleanup, accesibilidad, toast).
 *
 * Cubre (contrato de la tarea):
 * - badge count (no-ackeadas)
 * - parse tolerante (ausente/corrupta → vacía + flags default true, sin throw)
 * - apagado → mensaje, no error
 * - ack optimista (sin esperar poll/red)
 * - `shouldToast` (osFlag true + no focused + id no visto + no acked → true)
 * - dedupe cap 200 con evicción de los más viejos
 * - POLL_MS === 5000
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTIFICATION_BODY_PREVIEW_MAX,
  POLL_MS,
  TOASTED_IDS_CAP,
  ackNotificationById,
  addToastedId,
  applyOptimisticAck,
  collectToastable,
  countUnacked,
  fetchNotifications,
  formatNotificationDate,
  isDocumentFocused,
  notificationAckUrl,
  notificationsUrl,
  parseNotificationsResponse,
  pruneToastedIds,
  shouldToast,
} from "../src/features/factoryLab/components/notificationsUi.ts";
import type { FetchLike, UiNotification } from "../src/features/factoryLab/components/notificationsUi.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BELL_PATH = path.join(HERE, "..", "src", "features", "factoryLab", "components", "NotificationsBell.tsx");
const UI_PATH = path.join(HERE, "..", "src", "features", "factoryLab", "components", "notificationsUi.ts");

function makeNotif(partial: Partial<UiNotification> & { id: string }): UiNotification {
  return {
    kind: "ask_human",
    title: "t",
    body: "b",
    at: new Date().toISOString(),
    acked: false,
    ...partial,
  };
}

function mockFetchOk(payload: unknown): FetchLike {
  return async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

// ── Cotas (Regla 7) ─────────────────────────────────────────────────────────

test("POLL_MS === 5000 (polling fijo del centro)", () => {
  assert.equal(POLL_MS, 5000);
});

test("TOASTED_IDS_CAP === 200 (dedupe de toast con cota)", () => {
  assert.equal(TOASTED_IDS_CAP, 200);
});

// ── Badge count ─────────────────────────────────────────────────────────────

test("countUnacked cuenta solo no-ackeadas", () => {
  const list = [
    makeNotif({ id: "a", acked: false }),
    makeNotif({ id: "b", acked: true }),
    makeNotif({ id: "c", acked: false }),
  ];
  assert.equal(countUnacked(list), 2);
  assert.equal(countUnacked([]), 0);
});

test("countUnacked tolerante: corrupto → 0 sin throw", () => {
  assert.equal(countUnacked(null), 0);
  assert.equal(countUnacked(undefined), 0);
  assert.equal(countUnacked("basura"), 0);
  assert.equal(countUnacked([null, 42, { acked: false }]), 1);
});

// ── Parse tolerante ─────────────────────────────────────────────────────────

test("parse: respuesta ausente/corrupta → vacía + flags default true, sin throw", () => {
  for (const bad of [null, undefined, 42, "x", [], { nope: 1 }]) {
    const p = parseNotificationsResponse(bad);
    assert.deepEqual(p.notifications, []);
    assert.equal(p.notificationsEnabled, true);
    assert.equal(p.osNotifications, true);
  }
});

test("parse: respuesta válida conserva todo + flags", () => {
  const p = parseNotificationsResponse({
    notifications: [
      { id: "n-1", kind: "ask_human", title: "T", body: "B", at: "2026-09-03T00:00:00.000Z", acked: false, workItemId: "w1" },
      { id: "n-2", kind: "benchmark-done", title: "T2", body: "B2", at: "x", acked: true },
    ],
    notificationsEnabled: true,
    osNotifications: false,
  });
  assert.equal(p.notifications.length, 2);
  assert.equal(p.notifications[0]?.workItemId, "w1");
  assert.equal(p.notifications[1]?.acked, true);
  assert.equal(p.notificationsEnabled, true);
  assert.equal(p.osNotifications, false);
});

test("parse: items rotos se omiten sin romper el resto", () => {
  const p = parseNotificationsResponse({
    notifications: [
      null,
      { id: "", kind: "ask_human", title: "T", body: "B", at: "", acked: false },
      { id: "ok", kind: "ask_human", title: "T", body: "B", at: "", acked: false },
    ],
    notificationsEnabled: true,
    osNotifications: true,
  });
  assert.equal(p.notifications.length, 1);
  assert.equal(p.notifications[0]?.id, "ok");
});

test("apagado: notificationsEnabled:false se respeta (mensaje, no error)", () => {
  const p = parseNotificationsResponse({
    notifications: [],
    notificationsEnabled: false,
    osNotifications: true,
  });
  assert.equal(p.notificationsEnabled, false);
  // El panel muestra "notificaciones apagadas" en vez de error: el fuente lo prueba.
  const src = fs.readFileSync(BELL_PATH, "utf-8");
  assert.ok(src.includes("notificaciones apagadas"));
});

// ── Ack optimista ───────────────────────────────────────────────────────────

test("applyOptimisticAck marca acked sin mutar el original", () => {
  const prev = [makeNotif({ id: "a" }), makeNotif({ id: "b" })];
  const next = applyOptimisticAck(prev, "a");
  assert.equal(next.find((n) => n.id === "a")?.acked, true);
  assert.equal(next.find((n) => n.id === "b")?.acked, false);
  assert.equal(prev.find((n) => n.id === "a")?.acked, false);
});

test("applyOptimisticAck con id desconocido/corrupto no rompe", () => {
  const prev = [makeNotif({ id: "a" })];
  assert.equal(applyOptimisticAck(prev, "zzz").length, 1);
  assert.deepEqual(applyOptimisticAck(null, "a"), []);
  assert.deepEqual(applyOptimisticAck(undefined, "a"), []);
});

// ── shouldToast ─────────────────────────────────────────────────────────────

test("shouldToast: caso feliz → true", () => {
  assert.equal(
    shouldToast({
      osNotifications: true,
      documentFocused: false,
      seenIds: new Set<string>(),
      notification: makeNotif({ id: "n-1" }),
    }),
    true,
  );
});

test("shouldToast: resto de la matriz → false", () => {
  const base = {
    osNotifications: true as unknown,
    documentFocused: false as unknown,
    seenIds: new Set<string>() as Set<string>,
    notification: makeNotif({ id: "n-1" }),
  };
  assert.equal(shouldToast({ ...base, osNotifications: false }), false);
  assert.equal(shouldToast({ ...base, documentFocused: true }), false);
  assert.equal(shouldToast({ ...base, seenIds: new Set(["n-1"]) }), false);
  assert.equal(shouldToast({ ...base, notification: makeNotif({ id: "n-1", acked: true }) }), false);
  assert.equal(shouldToast({ ...base, notification: null }), false);
  assert.equal(shouldToast({ ...base, notification: makeNotif({ id: "" }) }), false);
});

// ── Dedupe cap 200 con evicción ─────────────────────────────────────────────

test("addToastedId/pruneToastedIds: cap 200 con evicción de los más viejos", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) addToastedId(seen, `id-${i}`);
  assert.equal(seen.size, 200);
  addToastedId(seen, "id-nuevo");
  assert.equal(seen.size, 200);
  assert.ok(!seen.has("id-0"), "el más viejo se evicta");
  assert.ok(seen.has("id-nuevo"));
  assert.ok(seen.has("id-199"));
});

test("pruneToastedIds tolerante + addToastedId ignora ids inválidos", () => {
  const seen = new Set<string>(["a"]);
  addToastedId(seen, "");
  assert.equal(seen.size, 1);
  assert.equal(pruneToastedIds(new Set<string>()).size, 0);
});

test("collectToastable: solo no-ackeadas no-vistas", () => {
  const list = [
    makeNotif({ id: "a" }),
    makeNotif({ id: "b", acked: true }),
    makeNotif({ id: "c" }),
  ];
  const out = collectToastable(list, new Set(["c"]));
  assert.deepEqual(out.map((n) => n.id), ["a"]);
  assert.deepEqual(collectToastable(null, new Set()), []);
});

// ── Fetch con mocks inyectados (cero red real) ──────────────────────────────

test("fetchNotifications con mock ok → parseado", async () => {
  const payload = {
    notifications: [{ id: "n-1", kind: "ask_human", title: "T", body: "B", at: "", acked: false }],
    notificationsEnabled: true,
    osNotifications: true,
  };
  const p = await fetchNotifications(mockFetchOk(payload), 17681);
  assert.equal(p.notifications.length, 1);
  assert.equal(p.notificationsEnabled, true);
});

test("fetchNotifications con mock caído / !ok → lanza (el componente lo silencia)", async () => {
  const failing: FetchLike = async () => {
    throw new Error("boom");
  };
  await assert.rejects(() => fetchNotifications(failing, 17681));
  const notOk: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => fetchNotifications(notOk, 17681));
});

test("ackNotificationById: ok → true; 404/red → false sin throw", async () => {
  assert.equal(await ackNotificationById(mockFetchOk({ ok: true }), 17681, "n-1"), true);
  const nf: FetchLike = async () => ({ ok: false, status: 404, json: async () => ({ error: "notification not found" }) });
  assert.equal(await ackNotificationById(nf, 17681, "missing"), false);
  const down: FetchLike = async () => {
    throw new Error("down");
  };
  assert.equal(await ackNotificationById(down, 17681, "n-1"), false);
  assert.equal(await ackNotificationById(mockFetchOk({}), 17681, ""), false);
});

test("URLs del centro (sin puertos hardcodeados)", () => {
  assert.equal(notificationsUrl(17681), "http://127.0.0.1:17681/factory/notifications");
  assert.equal(notificationAckUrl(17681, "n-1"), "http://127.0.0.1:17681/factory/notifications/n-1/ack");
});

// ── Formato fecha + foco (fail-safe) ────────────────────────────────────────

test("formatNotificationDate: válida → local; inválida → —", () => {
  assert.notEqual(formatNotificationDate("2026-09-03T00:00:00.000Z"), "—");
  assert.equal(formatNotificationDate("no-fecha"), "—");
  assert.equal(formatNotificationDate(null), "—");
});

test("isDocumentFocused fail-safe sin DOM → true (prefiere no toastear)", () => {
  assert.equal(isDocumentFocused(), true);
});

// ── Guards estáticos del componente (contrato vivo) ─────────────────────────

test("NotificationsBell: POLL_MS exportado, 1 solo intervalo con cleanup", () => {
  const src = fs.readFileSync(BELL_PATH, "utf-8");
  assert.ok(src.includes("POLL_MS"), "exporta POLL_MS para tests");
  assert.ok(src.includes("5000") || fs.readFileSync(UI_PATH, "utf-8").includes("5000"));
  // `window.setInterval(` (llamada real, no comentarios ni clearInterval).
  const starts = src.match(/window\.setInterval\s*\(/g) ?? [];
  assert.equal(starts.length, 1, `un solo setInterval, hay ${starts.length}`);
  assert.ok(src.includes("clearInterval"), "cleanup del intervalo");
  assert.ok(src.includes("}, POLL_MS)"), "el intervalo usa POLL_MS");
});

test("NotificationsBell: accesible + toast renderer best-effort + ESM", () => {
  const src = fs.readFileSync(BELL_PATH, "utf-8");
  const ui = fs.readFileSync(UI_PATH, "utf-8");
  assert.ok(src.includes("aria-label"), "button con aria-label");
  assert.ok(src.includes("isDocumentFocused"), "gate de foco");
  assert.ok(src.includes("fireOsToastBestEffort"), "toast vía helper best-effort");
  assert.ok(ui.includes("requestPermission"), "permiso best-effort en el helper");
  assert.ok(src.includes("osNotifications"), "toast solo con flag osNotifications");
  assert.ok(!/\brequire\s*\(\s*["']/.test(src) && !/\brequire\s*\(\s*["']/.test(ui), "ESM: cero require()");
});

test("NOTIFICATION_BODY_PREVIEW_MAX existe (cap visual del body)", () => {
  assert.ok(NOTIFICATION_BODY_PREVIEW_MAX > 0);
});
