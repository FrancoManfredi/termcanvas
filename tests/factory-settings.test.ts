/**
 * P4 — Gate persistente del factory (`factory/.settings.json`).
 *
 * Cubre el store (`readFactorySettings` / `writeBotReconcileSetting`), la
 * resolución del gate (env > setting > default), el snapshot de
 * GET/POST /factory/settings y la validación del body. Todo offline sobre un
 * sandbox (`TERMCANVAS_FACTORY_DIR`), cero daemon, cero red.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyBotReconcileSetting,
  buildFactorySettingsSnapshot,
  getFactorySettingsPath,
  readBotReconcileSetting,
  readFactorySettings,
  resolveBotReconcileGate,
  writeBotReconcileSetting,
} from "../headless-runtime/factory/settings/factorySettingsStore.ts";

// ── Sandbox factory (el settings file nunca toca el repo real) ──
const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "p4-settings-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

function resetSettingsFile(): void {
  try {
    fs.rmSync(getFactorySettingsPath(), { force: true });
  } catch {}
}

test.after(() => {
  try {
    fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  } catch {}
});

test("settings: archivo ausente equivale a settings vacíos y gate default off", () => {
  resetSettingsFile();
  assert.deepEqual(readFactorySettings(), { version: 1 });
  assert.equal(readBotReconcileSetting(), null);
  assert.deepEqual(resolveBotReconcileGate({}), { enabled: false, source: "default" });
});

test("settings: roundtrip de escritura atómica (botReconcile + updatedAt)", () => {
  resetSettingsFile();
  const wrote = writeBotReconcileSetting(true);
  assert.deepEqual(wrote, { ok: true, value: true });
  const file = getFactorySettingsPath();
  assert.ok(fs.existsSync(file), "archivo creado");
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  assert.equal(raw.version, 1);
  assert.equal(raw.botReconcile, true);
  assert.equal(typeof raw.updatedAt, "string");
  assert.equal(readBotReconcileSetting(), true);
  assert.deepEqual(resolveBotReconcileGate({}), { enabled: true, source: "setting" });
  assert.deepEqual(resolveBotReconcileGate({ TERMCANVAS_BOT_RECONCILE: "0" }), {
    enabled: false,
    source: "env",
  });
  assert.deepEqual(resolveBotReconcileGate({ TERMCANVAS_BOT_RECONCILE: "1" }), {
    enabled: true,
    source: "env",
  });
  // Merge: apagar conserva la forma y vuelve a default/setting off.
  assert.deepEqual(writeBotReconcileSetting(false), { ok: true, value: false });
  assert.deepEqual(resolveBotReconcileGate({}), { enabled: false, source: "setting" });
  resetSettingsFile();
});

test("settings: env vacío o valor raro cae al setting (solo 1/0 son override)", () => {
  resetSettingsFile();
  writeBotReconcileSetting(true);
  assert.deepEqual(resolveBotReconcileGate({ TERMCANVAS_BOT_RECONCILE: "" }), {
    enabled: true,
    source: "setting",
  });
  assert.deepEqual(resolveBotReconcileGate({ TERMCANVAS_BOT_RECONCILE: "true" }), {
    enabled: true,
    source: "setting",
  });
  resetSettingsFile();
});

test("settings: archivo corrupto o con shape basura se ignora sin lanzar", () => {
  resetSettingsFile();
  fs.mkdirSync(SANDBOX_FACTORY, { recursive: true });
  fs.writeFileSync(getFactorySettingsPath(), "{no-json", "utf-8");
  assert.deepEqual(readFactorySettings(), { version: 1 });
  assert.equal(readBotReconcileSetting(), null);
  fs.writeFileSync(getFactorySettingsPath(), JSON.stringify([1, 2, 3]), "utf-8");
  assert.deepEqual(readFactorySettings(), { version: 1 });
  fs.writeFileSync(
    getFactorySettingsPath(),
    JSON.stringify({ version: 1, botReconcile: "yes", updatedAt: 7 }),
    "utf-8",
  );
  assert.deepEqual(readFactorySettings(), { version: 1 });
  resetSettingsFile();
});

test("settings: write rechaza valores no booleanos sin tocar disco", () => {
  resetSettingsFile();
  assert.deepEqual(writeBotReconcileSetting("1"), {
    ok: false,
    error: "botReconcile must be a boolean",
  });
  assert.ok(!fs.existsSync(getFactorySettingsPath()), "sin archivo ante valor inválido");
});

test("settings: snapshot {settings, gate, envOverride} y validación del POST", () => {
  resetSettingsFile();
  const def = buildFactorySettingsSnapshot({});
  assert.deepEqual(def, {
    ok: true,
    settings: { botReconcile: false },
    gate: { enabled: false, source: "default" },
    envOverride: null,
  });
  const envOn = buildFactorySettingsSnapshot({ TERMCANVAS_BOT_RECONCILE: "1" });
  assert.deepEqual(envOn.settings, { botReconcile: true });
  assert.equal(envOn.envOverride, "1");
  assert.deepEqual(envOn.gate, { enabled: true, source: "env" });
  assert.deepEqual(applyBotReconcileSetting(null), { ok: false, error: "body must be a JSON object" });
  assert.deepEqual(applyBotReconcileSetting({}), { ok: false, error: "botReconcile must be a boolean" });
  assert.deepEqual(applyBotReconcileSetting({ botReconcile: "on" }), {
    ok: false,
    error: "botReconcile must be a boolean",
  });
  assert.deepEqual(applyBotReconcileSetting({ botReconcile: true }), { ok: true, value: true });
  const after = buildFactorySettingsSnapshot({});
  assert.deepEqual(after.settings, { botReconcile: true });
  assert.deepEqual(after.gate, { enabled: true, source: "setting" });
  assert.equal(after.envOverride, null);
  resetSettingsFile();
});
