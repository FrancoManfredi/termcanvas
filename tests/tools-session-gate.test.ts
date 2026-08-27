import test from "node:test";
import assert from "node:assert/strict";
import {
  createHeadlessGate,
  type HeadlessGate,
} from "../src/planner/headlessGate.ts";

// El gate de sesiones headless (toolsSession, securitySession) exige DOS
// señales — artefacto en disco + exit 0 — pero el ORDEN de llegada es una
// carrera real: el orquestador escribe el archivo y sale milisegundos
// después, así que el evento de exit suele ganarle al poller. La primera
// versión exigía fileFound && exit en un único instante y se tragaba el
// exit-antes-de-archivo: el botón "Continuar al diagnóstico LLM" quedaba en
// "Esperando…" para siempre CON exit 0 visible en el log (bug real de la
// categoría diseno-patrones, 25/8/2026). Estos tests fijan que TODAS las
// ordenaciones resuelven bien.

type GateEvent =
  | ["ready", string]
  | ["completed", number]
  | ["failed", string];

function makeGate(): { gate: HeadlessGate<string>; events: GateEvent[] } {
  const events: GateEvent[] = [];
  const gate = createHeadlessGate<string>({
    onArtifactReady: (detail) => events.push(["ready", detail]),
    onCompleted: (exitCode) => events.push(["completed", exitCode]),
    onFailed: (message) => events.push(["failed", message]),
  });
  return { gate, events };
}

test("archivo → exit 0: ready primero, completed después", () => {
  const { gate, events } = makeGate();
  gate.markArtifact("/repo/.agents/planning/tool-findings-diseno-patrones-1.json");
  assert.deepEqual(events, [
    ["ready", "/repo/.agents/planning/tool-findings-diseno-patrones-1.json"],
  ]);

  gate.markExit(0, () => "no debería fallar");
  assert.deepEqual(events[1], ["completed", 0]);
  assert.equal(events.length, 2);
});

test("REGRESIÓN del bug: exit 0 → archivo (el exit ganó la carrera) igual completa", () => {
  const { gate, events } = makeGate();

  // El poller todavía no vio el archivo cuando llega el exit.
  gate.markExit(0, () => "no debería fallar");
  assert.deepEqual(events, [], "el exit solo no completa");

  // El poller (o la lectura defensiva post-exit) encuentra el archivo:
  // acá se entregan ready Y completed, en ese orden.
  gate.markArtifact("/repo/.agents/planning/tool-findings-seguridad-2.json");
  assert.deepEqual(events, [
    ["ready", "/repo/.agents/planning/tool-findings-seguridad-2.json"],
    ["completed", 0],
  ]);
});

test("exit != 0 sin archivo: failed con 'sin escribir' en el mensaje", () => {
  const { gate, events } = makeGate();
  gate.markExit(3, (artifactReady) =>
    `terminó con error (exit 3)${artifactReady ? "" : " sin escribir tool-findings"}`,
  );
  assert.deepEqual(events, [["failed", "terminó con error (exit 3) sin escribir tool-findings"]]);
});

test("exit != 0 DESPUÉS del archivo: failed sin 'sin escribir' y SIN completed", () => {
  const { gate, events } = makeGate();
  gate.markArtifact("/repo/.agents/planning/security-result-1.json");
  gate.markExit(2, (artifactReady) =>
    `terminó con error (exit 2)${artifactReady ? "" : " sin escribir security-result"}`,
  );
  assert.deepEqual(events, [
    ["ready", "/repo/.agents/planning/security-result-1.json"],
    ["failed", "terminó con error (exit 2)"],
  ]);
});

test("idempotencia: doble markArtifact no duplica ready ni completed", () => {
  const { gate, events } = makeGate();
  gate.markArtifact("a.json");
  gate.markArtifact("a.json");
  gate.markExit(0, () => "x");
  gate.markExit(0, () => "x");
  assert.deepEqual(events, [
    ["ready", "a.json"],
    ["completed", 0],
  ]);
});

test("la primera señal de exit gana: un exit tardío no revoca ni pisa nada", () => {
  const { gate, events } = makeGate();
  gate.markExit(0, () => "x");
  gate.markArtifact("b.json");
  gate.markExit(1, () => "tardío");
  assert.deepEqual(events, [
    ["ready", "b.json"],
    ["completed", 0],
  ]);
});

test("tras un fail, un artefacto tardío no revive la sesión", () => {
  const { gate, events } = makeGate();
  gate.markExit(9, () => "falló");
  gate.markArtifact("c.json");
  assert.deepEqual(events, [["failed", "falló"]]);
});
