// Tests de los helpers puros del selector "Models per phase".

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPhaseModelGroups,
  refFromOptionValue,
  flattenModelOptions,
  filterModelOptions,
} from "../src/components/settings/phaseModelOptions.ts";
import type { ModelCatalog } from "../shared/modelCatalog.ts";

const CATALOG: ModelCatalog = {
  providers: [
    {
      id: "zai",
      name: "Z.ai",
      connected: false,
      models: [{ providerID: "zai", modelID: "glm-5", name: "GLM-5", status: "active", contextWindow: 128000, variants: [] }],
    },
    {
      id: "opencode-go",
      name: "OpenCode Go",
      connected: true,
      models: [
        { providerID: "opencode-go", modelID: "hy3", name: "HY3", status: "active", contextWindow: 128000, variants: [] },
        { providerID: "opencode-go", modelID: "deepseek-v4-flash", name: "DS", status: "active", contextWindow: 1000000, variants: ["max"] },
      ],
    },
  ],
  defaults: { "opencode-go": "hy3" },
  fetchedAt: Date.now(),
};

test("agrupa por proveedor preservando conexión y valores canónicos", () => {
  const groups = buildPhaseModelGroups(CATALOG);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].providerId, "zai");
  assert.equal(groups[0].connected, false);
  assert.deepEqual(
    groups[1].options.map((o) => o.value),
    ["opencode-go/hy3", "opencode-go/deepseek-v4-flash"],
  );
});

test("catálogo nulo → sin grupos (estado de carga)", () => {
  assert.deepEqual(buildPhaseModelGroups(null), []);
  assert.deepEqual(buildPhaseModelGroups(undefined), []);
});

test("value vacío = volver al default (null)", () => {
  assert.equal(refFromOptionValue("", null), null);
});

test("value malformado no produce ref", () => {
  assert.equal(refFromOptionValue("sin-barra", null), null);
  assert.equal(refFromOptionValue("/x", null), null);
  assert.equal(refFromOptionValue("p/", null), null);
});

test("value nuevo produce ref SIN variante heredada", () => {
  assert.deepEqual(
    refFromOptionValue("opencode-go/hy3", {
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "max",
    }),
    { providerID: "opencode-go", modelID: "hy3" },
  );
});

test("re-confirmar el MISMO par conserva su variante efectiva", () => {
  assert.deepEqual(
    refFromOptionValue("opencode-go/deepseek-v4-flash", {
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "max",
    }),
    { providerID: "opencode-go", modelID: "deepseek-v4-flash", variant: "max" },
  );
});

// ─── Combobox: flatten + filtrado tokenizado ─────────────────────────────

test("flatten aplana grupos con metadatos de proveedor", () => {
  const flat = flattenModelOptions(buildPhaseModelGroups(CATALOG));
  assert.equal(flat.length, 3);
  const glm = flat.find((o) => o.value === "zai/glm-5")!;
  assert.equal(glm.providerLabel, "Z.ai");
  assert.equal(glm.connected, false);
});

test("sin query devuelve todo (capado) y el total real", () => {
  const flat = flattenModelOptions(buildPhaseModelGroups(CATALOG));
  const { items, total } = filterModelOptions(flat, "", 2);
  assert.equal(total, 3);
  assert.equal(items.length, 2);
});

test("tokens AND case-insensitive cruzan proveedor y modelo", () => {
  const flat = flattenModelOptions(buildPhaseModelGroups(CATALOG));
  // "opencode deep" matchea deepseek-v4-flash bajo opencode-go.
  const { items, total } = filterModelOptions(flat, "OpenCode DEEP");
  assert.equal(total, 1);
  assert.equal(items[0].value, "opencode-go/deepseek-v4-flash");
  // Por label de proveedor también: "z.ai" matchea glm-5.
  assert.equal(filterModelOptions(flat, "z.ai").total, 1);
});

test("orden conectados-primero dentro de los matches", () => {
  const flat = flattenModelOptions(buildPhaseModelGroups(CATALOG));
  // Query que matchea ambos proveedores: "o" está en ambos nombres/ids.
  const { items } = filterModelOptions(flat, "o");
  const firstDisconnected = items.findIndex((o) => !o.connected);
  const lastConnected = items.map((o) => o.connected).lastIndexOf(true);
  if (firstDisconnected !== -1 && lastConnected !== -1) {
    assert.ok(lastConnected < firstDisconnected);
  }
});

test("cap recorta items pero total cuenta todos los matches", () => {
  const flat = flattenModelOptions(buildPhaseModelGroups(CATALOG));
  const { items, total } = filterModelOptions(flat, "", 1);
  assert.equal(items.length, 1);
  assert.equal(total, 3);
  // El primero es de un proveedor conectado.
  assert.equal(items[0].connected, true);
});
