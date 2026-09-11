/**
 * mergeDiskAndModelFiles — el disco manda, el modelo agrega.
 * Regresión del bug "solo package.json": el issue nombraba 1 path explícito,
 * el fast-path devolvía solo ese y el reconcile REEMPLAZABA la lista del
 * modelo — review veía 1 archivo aunque el builder tocó 4.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeDiskAndModelFiles } from "../headless-runtime/implement/minimalChange.ts";

test("fast-path de 1 archivo no pierde lo tocado (caso package.json)", () => {
  const out = mergeDiskAndModelFiles(
    ["package.json"],
    ["src/auth.ts", "src/login.ts", "tests/auth.test.ts", "package.json"],
    "actualizá la versión en package.json y agregá login con tests",
  );
  assert.ok(out.includes("package.json"), "el disco viaja");
  assert.ok(out.includes("src/auth.ts"), "lo tocado no se pierde");
  assert.ok(out.includes("src/login.ts"));
  assert.ok(out.includes("tests/auth.test.ts"));
  assert.equal(out.length, 4, "sin duplicados");
  assert.equal(out[0], "package.json", "el disco va primero");
});

test("disco vacío conserva la del modelo (git no disponible)", () => {
  assert.deepEqual(
    mergeDiskAndModelFiles([], ["src/a.ts"], "fix auth bug"),
    ["src/a.ts"],
  );
});

test("modelo vacío conserva el disco", () => {
  assert.deepEqual(
    mergeDiskAndModelFiles(["src/a.ts", "src/b.ts"], [], "fix auth bug"),
    ["src/a.ts", "src/b.ts"],
  );
});

test("entradas inválidas nunca lanzan", () => {
  assert.deepEqual(mergeDiskAndModelFiles(null, undefined, "x"), []);
  assert.deepEqual(mergeDiskAndModelFiles("no-array" as never, 42 as never), []);
});

test("tope 50 preservado", () => {
  const disk = Array.from({ length: 40 }, (_, i) => `d${i}.ts`);
  const model = Array.from({ length: 40 }, (_, i) => `m${i}.ts`);
  const out = mergeDiskAndModelFiles(disk, model, "x");
  assert.equal(out.length, 50);
  assert.ok(out.includes("d0.ts"), "disco primero");
});
