/**
 * FASE 3 E2 — dominio notifications + definition + health.
 * node:test + tsx. Offline total: sin daemon, sin red, cero LLM real.
 * Store de notificaciones en sandbox (TERMCANVAS_FACTORY_DIR en tmpdir).
 * No muta `factory/` real ni jobs productivos.
 *
 * Cubre lo pedido en F3-E2:
 * - Ring y dedupe y flags via el dominio (dueno E2, identidad con el server).
 * - Ack por id con longitud exacta mas rechazo de traversal.
 * - Badge bueno y malo via el dominio (estado validado con file, line y
 *   rule; bueno con la definition real, malo con sandbox roto).
 * - Snapshot de salud via el dominio (pendiente y corriendo, uptime,
 *   buildId y puertos por discovery, cero literales).
 * - Delegacion delgada del cascaron (identidad C7, formas intactas).
 *
 * Reglas citadas: C1 (ESM, cotas: anillo 100, sin recorridos nuevos en los
 * dominios), C2 (fail-safe), C3 (un escritor), C4 (best-effort), C5
 * (aditivo: pacts F01-F14, polling y flags intactos), C6 y C7 (identidad, no
 * espejo), C8 (rutas en tabla), C10 (cada caso cita su bloque).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Dominios F3-E2 (duenos que el server usa) ──
import {
  ackNotificationById,
  buildNotificationsResponse as domainBuildNotifications,
  isNotificationsListRoute as domainIsList,
  parseNotificationAckPath as domainParseAck,
} from "../headless-runtime/factory/notifications/notificationRoutes.ts";
import {
  buildDefinitionStatusResponse as domainBuildDefinition,
  isDefinitionStatusRoute as domainIsDefinition,
} from "../headless-runtime/factory/definition/definitionRoutes.ts";
import {
  buildHealthPayload as domainBuildHealth,
  buildMinimalHealthSnapshot as domainBuildMinimal,
} from "../headless-runtime/factory/health/healthRoutes.ts";

// ── Cascaron (re-exporta por identidad C7; formas intactas) ──
import {
  buildDefinitionStatusResponse as serverBuildDefinition,
  buildNotificationsResponse as serverBuildNotifications,
  parseNotificationAckPath as serverParseAck,
} from "../headless-runtime/factory/factoryServer.ts";

// ── Dueno del store (solo via dominio; el test nunca lo importa directo salvo sandbox) ──
import {
  NOTIFICATIONS_MAX,
  ackNotification,
  listNotifications,
  notify,
  resetNotificationsForTests,
  resetNotificationsOverrideForTests,
  setNotificationsOverrideForTests,
} from "../headless-runtime/notify/notifications.ts";

// ── Sandbox factory (todo .notifications.json va aca, nunca al repo real) ──
const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "f3e2-ndh-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

function resetStore(): void {
  try {
    resetNotificationsForTests();
  } catch {}
  try {
    resetNotificationsOverrideForTests();
  } catch {}
  try {
    setNotificationsOverrideForTests(true);
  } catch {}
}

test.after(() => {
  try {
    resetNotificationsForTests();
  } catch {}
  try {
    resetNotificationsOverrideForTests();
  } catch {}
  try {
    fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  } catch {}
});

// ── A. Identidad C7: el cascaron no duplica (misma referencia) ──

test("A1 notificaciones: el cascaron re-exporta las MISMAS funciones (identidad, C7)", () => {
  assert.equal(serverParseAck, domainParseAck);
  assert.equal(serverBuildNotifications, domainBuildNotifications);
});

test("A2 definition: el cascaron delega en el dominio (misma forma, buildId del cascaron)", () => {
  const viaServer = serverBuildDefinition();
  const viaDomain = domainBuildDefinition(viaServer.buildId);
  assert.equal(viaServer.valid, viaDomain.valid);
  assert.deepEqual(viaServer.issues, viaDomain.issues);
  assert.equal(typeof viaServer.buildId, "string");
  assert.ok(viaServer.buildId.length > 0);
});

// ── B. Rutas en tabla (C8): matchers del dominio ──

test("B1 matchers: lista y estado solo en su metodo mas path exacto (C8)", () => {
  assert.equal(domainIsList("GET", "/factory/notifications"), true);
  assert.equal(domainIsList("POST", "/factory/notifications"), false);
  assert.equal(domainIsList("GET", "/factory/notifications/extra"), false);
  assert.equal(domainIsDefinition("GET", "/factory/definition/status"), true);
  assert.equal(domainIsDefinition("POST", "/factory/definition/status"), false);
  assert.equal(domainIsDefinition("GET", "/factory/definition/status/extra"), false);
});

// ── C. Ring, dedupe y flags via el dominio ──

test("C1 ring 100 via dominio: todas-unacked equivale a descartar la mas vieja", () => {
  resetStore();
  let firstId = "";
  for (let i = 0; i < 100; i++) {
    const n = notify({ kind: "ask_human", workItemId: `job-ndh-${i}`, title: `t-${i}`, body: `b-${i}` });
    assert.ok(n);
    if (i === 0) firstId = n!.id;
  }
  assert.equal(NOTIFICATIONS_MAX, 100);
  const extra = notify({ kind: "ask_human", workItemId: "job-ndh-new", title: "t-new", body: "b-new" });
  assert.ok(extra);
  const payload = domainBuildNotifications();
  assert.equal(payload.notifications.length, 100);
  assert.ok(!payload.notifications.some((n) => n.id === firstId));
  assert.ok(payload.notifications.some((n) => n.id === extra!.id));
  assert.equal(payload.notifications[0]!.id, extra!.id);
});

test("C2 dedupe via store: mismo evento 2 veces equivale a 1 (toast 1 por evento)", () => {
  resetStore();
  const first = notify({ kind: "ask_human", workItemId: "job-dedupe-ndh", title: "Titulo", body: "Cuerpo" });
  const second = notify({ kind: "ask_human", workItemId: "job-dedupe-ndh", title: "Titulo", body: "Cuerpo" });
  assert.ok(first && second);
  assert.equal(first!.id, second!.id);
  assert.equal(domainBuildNotifications().notifications.length, 1);
});

test("C3 flags via dominio: centro apagado equivale a GET con lista vacia (store NO borra)", () => {
  resetStore();
  const kept = notify({ kind: "ask_human", workItemId: "job-flag-ndh", title: "T", body: "B" });
  assert.ok(kept);
  setNotificationsOverrideForTests(false);
  try {
    const payload = domainBuildNotifications();
    assert.deepEqual(payload.notifications, []);
    assert.equal(payload.notificationsEnabled, false);
    assert.equal(typeof payload.osNotifications, "boolean");
    assert.equal(listNotifications().length, 1);
  } finally {
    resetNotificationsOverrideForTests();
    setNotificationsOverrideForTests(true);
  }
});

// ── D. Ack por id: longitud exacta mas rechazo de traversal ──

test("D1 ack parse: ruta exacta con id valido (longitud exacta 4)", () => {
  resetStore();
  const n = notify({ kind: "ask_human", title: "T", body: "B" });
  assert.ok(n);
  assert.deepEqual(domainParseAck(`/factory/notifications/${n!.id}/ack`), { id: n!.id });
  assert.ok("error" in domainParseAck("/factory/notifications/ack"));
  assert.ok("error" in domainParseAck("/factory/jobs/x/ack"));
  assert.ok("error" in domainParseAck("/factory/notifications/a/b/ack"));
});

test("D2 ack parse: rechaza traversal (.. , slash, backslash, codificado, % suelto)", () => {
  for (const bad of [
    "/factory/notifications/../x/ack",
    "/factory/notifications/a/b/ack",
    "/factory/notifications/%2e%2e/ack",
    "/factory/notifications/%2F/ack",
    "/factory/notifications/%5c/ack",
    "/factory/notifications/%zz/ack",
    "/factory/notifications/./ack",
    "/factory/notifications/notifications/ack",
    "/factory/notifications/ack/ack",
  ]) {
    assert.ok("error" in domainParseAck(bad), `debió rechazar ${bad}`);
  }
});

test("D3 ack por id via dominio: existe equivale a ok mas notificacion; inexistente equivale a 404 honesto", () => {
  resetStore();
  const n = notify({ kind: "proposal-ready", title: "Propuesta lista para revisar", body: "propuesta imp-1 lista" });
  assert.ok(n);
  const ok = ackNotificationById(n!.id);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.notification?.acked, true);
  assert.equal(ackNotification(n!.id), true);
  const missing = ackNotificationById("n-0000000000000-999999");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, "notification not found");
  const traversal = ackNotificationById("../escape");
  assert.equal(traversal.ok, false);
});

// ── E. Badge bueno y malo via el dominio ──

test("E1 badge bueno: definition real valida con buildId (file, line y rule para el badge)", () => {
  const payload = domainBuildDefinition("build-f3e2-bueno");
  assert.equal(typeof payload.valid, "boolean");
  assert.ok(Array.isArray(payload.issues));
  assert.ok(!Number.isNaN(Date.parse(payload.checkedAt)));
  assert.equal(payload.buildId, "build-f3e2-bueno");
  for (const issue of payload.issues) {
    assert.equal(typeof issue.file, "string");
    assert.equal(typeof issue.rule, "string");
    assert.equal(typeof issue.message, "string");
    assert.ok(issue.severity === "error" || issue.severity === "warn");
    if (issue.line !== undefined) {
      assert.ok(Number.isInteger(issue.line) && (issue.line as number) >= 1);
    }
  }
});

test("E2 badge malo: sandbox roto equivale a valid false con file y rule (sin tocar factory real)", () => {
  const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "f3e2-broken-"));
  const brokenFactory = path.join(brokenDir, "factory");
  try {
    fs.mkdirSync(brokenFactory, { recursive: true });
    fs.writeFileSync(path.join(brokenFactory, "factory.yaml"), "esto no es yaml valido: [{{{\n", "utf-8");
    const payload = domainBuildDefinition("build-f3e2-malo", brokenFactory);
    assert.equal(payload.valid, false);
    assert.ok(payload.issues.length > 0);
    assert.equal(payload.buildId, "build-f3e2-malo");
    for (const issue of payload.issues) {
      assert.equal(typeof issue.file, "string");
      assert.equal(typeof issue.rule, "string");
    }
  } finally {
    try {
      fs.rmSync(brokenDir, { recursive: true, force: true });
    } catch {}
  }
});

// ── F. Snapshot de salud via el dominio ──

test("F1 snapshot salud: pendiente y corriendo, uptime, buildId y puertos (cero literales)", () => {
  const payload = domainBuildHealth({
    pending: 2,
    running: 1,
    uptime: 12345,
    buildId: "build-f3e2-salud",
    version: "local",
    startedAt: Date.now() - 12345,
    factoryPort: 17777,
    opencodeUrl: "http://127.0.0.1:39999",
    opencodeStatus: "healthy",
    opencodePort: 39999,
    opencodeUptime: 5000,
  });
  assert.deepEqual(payload.queue, { pending: 2, running: 1 });
  assert.equal(payload.uptime, 12345);
  assert.equal(payload.buildId, "build-f3e2-salud");
  assert.equal(payload.factoryPort, 17777);
  assert.deepEqual(payload.ports, { factory: 17777, opencode: 39999 });
  assert.equal(payload.opencode.url, "http://127.0.0.1:39999");
  assert.equal(payload.opencode.status, "healthy");
  assert.ok(!Number.isNaN(Date.parse(payload.ts)));
  // P1: el gate post-bot viaja en salud (ausente → unknown honesto; presente → tal cual).
  assert.deepEqual(payload.botReconcile, { enabled: false, source: "unknown" });
  const gated = domainBuildHealth({
    pending: 0,
    running: 0,
    uptime: 1,
    buildId: "b",
    version: "local",
    startedAt: Date.now(),
    factoryPort: 17777,
    opencodeUrl: "",
    opencodeStatus: "not_started",
    opencodePort: null,
    opencodeUptime: 0,
    botReconcile: { enabled: true, source: "setting" },
  });
  assert.deepEqual(gated.botReconcile, { enabled: true, source: "setting" });
  const junkGate = domainBuildHealth({
    pending: 0,
    running: 0,
    uptime: 1,
    buildId: "b",
    version: "local",
    startedAt: Date.now(),
    factoryPort: 17777,
    opencodeUrl: "",
    opencodeStatus: "not_started",
    opencodePort: null,
    opencodeUptime: 0,
    botReconcile: "on",
  });
  assert.deepEqual(junkGate.botReconcile, { enabled: false, source: "unknown" });
});

test("F2 snapshot minimo: pendiente y corriendo mas uptime (forma intacta)", () => {
  const snap = domainBuildMinimal({ pending: 3, running: 0, uptime: 999, version: "local" });
  assert.deepEqual(snap, { pending: 3, running: 0, uptime: 999, version: "local" });
  const bad = domainBuildMinimal({ pending: -5, running: Number.NaN, uptime: "x", version: "" });
  assert.deepEqual(bad, { pending: 0, running: 0, uptime: 0, version: "local" });
});
