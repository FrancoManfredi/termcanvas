// Tests del catálogo de modelos (electron/model-catalog.ts).
// Sin server real: se inyecta un cliente falso vía setCatalogClient (mismo
// seam que el motor de entrevista). Cubren normalización defensiva del crudo
// del SDK, cache TTL, y la validación de fases contra el catálogo.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setCatalogClient,
  fetchModelCatalog,
  invalidateModelCatalog,
  validatePhaseAgainstCatalog,
  validateAllPhases,
  buildAlternatives,
  type CatalogClient,
  type ModelCatalog,
  type PhaseValidation,
} from "../electron/model-catalog.ts";
import { PHASE_IDS, type PhaseId, type ModelRef } from "../shared/phaseModels";

// ─── Fixture: respuesta cruda de provider.list ───────────────────────────

const FIXTURE = {
  all: [
    {
      id: "opencode-go",
      name: "OpenCode Go",
      models: {
        hy3: {
          id: "hy3",
          providerID: "opencode-go",
          name: "HY3",
          status: "active",
          limit: { context: 128000 },
          variants: {},
        },
        "deepseek-v4-flash": {
          id: "deepseek-v4-flash",
          providerID: "opencode-go",
          name: "DeepSeek V4 Flash",
          status: "active",
          limit: { context: 1000000 },
          variants: { max: {} },
        },
      },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-sonnet-4-6": { status: "active", limit: { context: 200000 }, variants: {} },
        "claude-opus-5": { status: "active", limit: { context: 200000 }, variants: {} },
      },
    },
    {
      id: "zai",
      name: "Z.ai",
      models: {
        "glm-5": { status: "active", limit: { context: 128000 }, variants: {} },
      },
    },
  ],
  default: { anthropic: "claude-sonnet-4-6", "opencode-go": "hy3" },
  connected: ["anthropic", "opencode-go"],
};

function makeMockClient(rawListResult: unknown) {
  let calls = 0;
  const client: CatalogClient = {
    provider: {
      list: async () => {
        calls++;
        // El SDK real envuelve la respuesta en { data, error }: el mock
        // reproduce ese envelope a partir del crudo.
        return { data: rawListResult } as Awaited<
          ReturnType<CatalogClient["provider"]["list"]>
        >;
      },
    },
  };
  return { client, getCalls: () => calls };
}

async function catalogWith(raw: unknown): Promise<ModelCatalog> {
  setCatalogClient(makeMockClient(raw).client);
  return fetchModelCatalog();
}

// ─── Normalización ───────────────────────────────────────────────────────

test("fetchModelCatalog normaliza proveedores, modelos, defaults y conexión", async () => {
  const catalog = await catalogWith(FIXTURE);

  assert.deepEqual(
    catalog.providers.map((p) => p.id),
    ["anthropic", "opencode-go", "zai"],
  );
  const go = catalog.providers.find((p) => p.id === "opencode-go")!;
  assert.equal(go.connected, true);
  // Modelos ordenados por modelID.
  assert.deepEqual(
    go.models.map((m) => m.modelID),
    ["deepseek-v4-flash", "hy3"],
  );
  const deepseek = go.models.find((m) => m.modelID === "deepseek-v4-flash")!;
  assert.equal(deepseek.contextWindow, 1000000);
  assert.deepEqual(deepseek.variants, ["max"]);
  const hy3 = go.models.find((m) => m.modelID === "hy3")!;
  assert.deepEqual(hy3.variants, []);

  const zai = catalog.providers.find((p) => p.id === "zai")!;
  assert.equal(zai.connected, false);

  assert.deepEqual(catalog.defaults, {
    anthropic: "claude-sonnet-4-6",
    "opencode-go": "hy3",
  });
});

test("cache TTL: la segunda llamada no re-invoca al server; force=true sí", async () => {
  const { client, getCalls } = makeMockClient(FIXTURE);
  setCatalogClient(client);

  await fetchModelCatalog();
  await fetchModelCatalog();
  assert.equal(getCalls(), 1);

  await fetchModelCatalog(true);
  assert.equal(getCalls(), 2);
});

test("error del endpoint se propaga como excepción accionable", async () => {
  setCatalogClient({
    provider: {
      list: async () => ({ error: { message: "boom" } }),
    },
  });
  await assert.rejects(() => fetchModelCatalog(), /provider\.list falló/);
});

test("crudo malformado no rompe la normalización", async () => {
  const catalog = await catalogWith({
    all: [null, {}, { id: "p1" }],
    default: null,
    connected: null,
  });
  assert.equal(catalog.providers.length, 1);
  const p1 = catalog.providers[0];
  assert.equal(p1.id, "p1");
  assert.equal(p1.connected, false);
  assert.deepEqual(p1.models, []);
  assert.deepEqual(catalog.defaults, {});
});

test("respuesta completamente vacía produce catálogo vacío sin lanzar", async () => {
  const catalog = await catalogWith({});
  assert.deepEqual(catalog.providers, []);
  assert.deepEqual(catalog.defaults, {});
});

// ─── Validación de fases ─────────────────────────────────────────────────

test("fase sin pin valida ok sin tocar el catálogo", async () => {
  const catalog = await catalogWith(FIXTURE);
  const result = validatePhaseAgainstCatalog("diagnosisLlm", catalog);
  assert.equal(result.ok, true);
  assert.equal(result.effective, null);
});

test("default de requirements (opencode-go/hy3) valida ok", async () => {
  const catalog = await catalogWith(FIXTURE);
  const result = validatePhaseAgainstCatalog("requirements", catalog);
  assert.equal(result.ok, true);
  assert.deepEqual(result.effective, { providerID: "opencode-go", modelID: "hy3" });
});

test("default de synthesis (deepseek + variant max) valida ok", async () => {
  const catalog = await catalogWith(FIXTURE);
  const result = validatePhaseAgainstCatalog("synthesis", catalog);
  assert.equal(result.ok, true);
});

test("proveedor inexistente falla con alternativas solo de conectados", async () => {
  const catalog = await catalogWith(FIXTURE);
  const result = validatePhaseAgainstCatalog("brief", catalog, {
    brief: { providerID: "fantasma", modelID: "nope" },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason!, /proveedor "fantasma"/i);
  const alts = result.alternatives!;
  assert.ok(alts.length > 0);
  for (const alt of alts) {
    assert.doesNotMatch(alt, /^zai\//); // zai NO está conectado: no se sugiere
  }
});

test("proveedor existente pero sin auth falla con mensaje accionable", async () => {
  const catalog = await catalogWith(FIXTURE);
  const result = validatePhaseAgainstCatalog("brief", catalog, {
    brief: { providerID: "zai", modelID: "glm-5" },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason!, /no está autenticado/);
  assert.match(result.reason!, /opencode auth login/);
});

test("modelo inexistente en proveedor conectado falla", async () => {
  const catalog = await catalogWith(FIXTURE);
  const result = validatePhaseAgainstCatalog("gapCheck", catalog, {
    gapCheck: { providerID: "anthropic", modelID: "claude-inventado" },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason!, /no existe en el proveedor "anthropic"/);
});

test("variant no soportada falla listando las soportadas", async () => {
  const catalog = await catalogWith(FIXTURE);
  const result = validatePhaseAgainstCatalog("synthesis", catalog, {
    synthesis: { providerID: "opencode-go", modelID: "deepseek-v4-flash", variant: "ultra" },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason!, /variant "ultra"/);
  assert.match(result.reason!, /max/);
});

test("variant sobre modelo sin variants declaradas pasa (no validable)", async () => {
  const catalog = await catalogWith(FIXTURE);
  const result = validatePhaseAgainstCatalog("synthesis", catalog, {
    synthesis: { providerID: "anthropic", modelID: "claude-sonnet-4-6", variant: "max" },
  });
  assert.equal(result.ok, true);
});

test("validateAllPhases devuelve solo las que fallan, con motivo", async () => {
  const catalog = await catalogWith(FIXTURE);
  const overrides: Partial<Record<PhaseId, ModelRef>> = {};
  for (const phase of PHASE_IDS) {
    overrides[phase] = { providerID: "fantasma", modelID: "nope" };
  }
  const failures: PhaseValidation[] = validateAllPhases(catalog, overrides);
  assert.equal(failures.length, PHASE_IDS.length);
  for (const failure of failures) {
    assert.equal(failure.ok, false);
    assert.ok(failure.reason && failure.reason.length > 0);
  }
});

test("validateAllPhases con el fixture sano no reporta fallos", async () => {
  const catalog = await catalogWith(FIXTURE);
  assert.deepEqual(validateAllPhases(catalog), []);
});

// ─── Cooldown tras fallo ─────────────────────────────────────────────────

test("tras un fallo, los fetch dentro del cooldown fallan seco sin re-invocar", async () => {
  // Cliente explícito de error: makeMockClient envuelve el crudo en {data}
  // y convertiría el fallo en un catálogo vacío exitoso.
  let calls = 0;
  const client: CatalogClient = {
    provider: {
      list: async () => {
        calls++;
        return { error: { message: "server caído" } };
      },
    },
  };
  setCatalogClient(client);

  await assert.rejects(() => fetchModelCatalog(), /provider\.list falló/);
  // Segundo intento dentro del cooldown: falla rápido SIN llamar al server.
  await assert.rejects(() => fetchModelCatalog(), /cooldown/);
  assert.equal(calls, 1);
});

test("force=true salta el cooldown y reintenta contra el server", async () => {
  let sano = false;
  const client: CatalogClient = {
    provider: {
      list: async () =>
        sano ? { data: FIXTURE } : { error: { message: "aún roto" } },
    },
  };
  setCatalogClient(client);

  await assert.rejects(() => fetchModelCatalog());
  // force ignora el cooldown; con el server sanado, ahora resuelve.
  sano = true;
  const catalog = await fetchModelCatalog(true);
  assert.equal(catalog.providers.length, 3);
});

test("invalidar limpia el cooldown y permite reintento inmediato", async () => {
  let sano = false;
  const client: CatalogClient = {
    provider: {
      list: async () =>
        sano ? { data: FIXTURE } : { error: { message: "aún roto" } },
    },
  };
  setCatalogClient(client);
  await assert.rejects(() => fetchModelCatalog());

  invalidateModelCatalog(); // limpia cachedCatalog + cooldown
  sano = true;
  const catalog = await fetchModelCatalog();
  assert.equal(catalog.providers.length, 3);
});

// ─── Alternativas ────────────────────────────────────────────────────────

test("buildAlternatives prioriza defaults de conectados y excluye desconectados", async () => {
  const catalog = await catalogWith(FIXTURE);
  const alts = buildAlternatives(catalog);
  // Defaults de los dos proveedores conectados primero.
  assert.equal(alts[0], "anthropic/claude-sonnet-4-6");
  assert.equal(alts[1], "opencode-go/hy3");
  // Ninguna alternativa apunta a un proveedor desconectado.
  for (const alt of alts) assert.doesNotMatch(alt, /^zai\//);
  // El resto son modelos reales de conectados, sin duplicados.
  assert.equal(new Set(alts).size, alts.length);
});
