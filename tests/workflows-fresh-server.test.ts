/**
 * Frescura de la config de agentes por nodo (fix PLATANO): si la revisión
 * vigente cambió desde que el singleton nació, el nodo corre en un server
 * recién nacido en vez de heredar el prompt/modelo viejo del singleton.
 * Puro, offline total.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseScopedServer } from "../headless-runtime/workflows/nodes/ai.ts";

test("scope del nodo fuerza server fresco", () => {
  assert.equal(
    shouldUseScopedServer({ hasNodeScope: true, currentRevision: 3, singletonRevision: 3 }),
    true,
  );
});

test("revisión cambiada fuerza server fresco aunque el nodo no declare nada", () => {
  assert.equal(
    shouldUseScopedServer({ hasNodeScope: false, currentRevision: 4, singletonRevision: 3 }),
    true,
    "el prompt editado aplica al próximo nodo sin esperar a que drene la cola",
  );
});

test("misma revisión sin scope usa el singleton", () => {
  assert.equal(
    shouldUseScopedServer({ hasNodeScope: false, currentRevision: 3, singletonRevision: 3 }),
    false,
  );
});

test("sin singleton conocido no fuerza: ensureClient bootea fresco igual", () => {
  assert.equal(
    shouldUseScopedServer({ hasNodeScope: false, currentRevision: 7, singletonRevision: null }),
    false,
  );
  assert.equal(
    shouldUseScopedServer({ hasNodeScope: false, currentRevision: null, singletonRevision: 7 }),
    false,
  );
});

test("junk nunca lanza ni fuerza", () => {
  assert.equal(
    shouldUseScopedServer({ hasNodeScope: false, currentRevision: "x", singletonRevision: {} }),
    false,
  );
  assert.equal(
    shouldUseScopedServer(null as never),
    false,
  );
});

test("huella de disco cambiada fuerza server fresco (edición a mano sin bump de API)", () => {
  assert.equal(
    shouldUseScopedServer({
      hasNodeScope: false,
      currentRevision: 3,
      singletonRevision: 3,
      currentFingerprint: 99,
      singletonFingerprint: 98,
    }),
    true,
    "el agent.md tocado a mano detecta sin esperar a un save por API",
  );
});

test("huella igual no fuerza nada cuando la revisión coincide", () => {
  assert.equal(
    shouldUseScopedServer({
      hasNodeScope: false,
      currentRevision: 3,
      singletonRevision: 3,
      currentFingerprint: 98,
      singletonFingerprint: 98,
    }),
    false,
  );
});

test("huella desconocida no fuerza (sin singleton o sin lectura de disco)", () => {
  assert.equal(
    shouldUseScopedServer({
      hasNodeScope: false,
      currentRevision: 3,
      singletonRevision: 3,
      currentFingerprint: null,
      singletonFingerprint: 98,
    }),
    false,
  );
  assert.equal(
    shouldUseScopedServer({
      hasNodeScope: false,
      currentRevision: 3,
      singletonRevision: 3,
      currentFingerprint: 98,
      singletonFingerprint: null,
    }),
    false,
  );
});
