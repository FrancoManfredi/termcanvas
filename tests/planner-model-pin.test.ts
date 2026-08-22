// Tests del pin de modelo por fase para las fases CLI (src/planner/modelPin).
// Cubren los flags generados para `opencode run` y para la TUI (donde
// --variant no existe), y la resolución fase→modelo leyendo las preferencias
// REALES. Un proceso por archivo de test: una sola instancia del store,
// reset en beforeEach.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PHASE_IDS } from "../shared/phaseModels.ts";
import { usePreferencesStore } from "../src/stores/preferencesStore.ts";
import {
  assertPhaseModelAvailable,
  extractOutputTail,
  resolvePhaseModelRef,
  runModelFlagArgs,
  shouldRunPhaseInTui,
  tuiModelFlagArgs,
} from "../src/planner/modelPin.ts";

const STORAGE_KEY = "termcanvas-preferences";

function installLocalStorage(initialValue?: string) {
  const backingStore = new Map<string, string>();
  if (initialValue !== undefined) {
    backingStore.set(STORAGE_KEY, initialValue);
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => backingStore.get(key) ?? null,
      setItem: (key: string, value: string) => backingStore.set(key, value),
      removeItem: (key: string) => backingStore.delete(key),
      clear: () => backingStore.clear(),
    },
  });
}

beforeEach(() => {
  installLocalStorage();
  // Limpia TODOS los overrides: el store es singleton por proceso y los
  // tests comparten instancia.
  for (const phase of PHASE_IDS) {
    usePreferencesStore.getState().setPhaseModel(phase, null);
  }
});

// ─── Flags para `opencode run` ───────────────────────────────────────────

test("sin pin no genera flags (default global de opencode)", () => {
  assert.deepEqual(runModelFlagArgs(null), []);
  assert.deepEqual(runModelFlagArgs(undefined), []);
});

test("run: --model provider/model sin variant", () => {
  assert.deepEqual(runModelFlagArgs({ providerID: "opencode-go", modelID: "hy3" }), [
    "--model",
    "opencode-go/hy3",
  ]);
});

test("run: --variant viaja como flag separado cuando hay variante", () => {
  assert.deepEqual(
    runModelFlagArgs({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "max",
    }),
    ["--model", "opencode-go/deepseek-v4-flash", "--variant", "max"],
  );
});

// ─── Flags para la TUI ───────────────────────────────────────────────────

test("tui: --model sin --variant (la TUI no acepta variant)", () => {
  assert.deepEqual(
    tuiModelFlagArgs({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "max",
    }),
    ["--model", "opencode-go/deepseek-v4-flash"],
  );
  assert.deepEqual(tuiModelFlagArgs(null), []);
});

// ─── Resolución desde las preferencias reales ────────────────────────────

test("resolución por defecto: fases CLI null, SDK su default", () => {
  assert.deepEqual(usePreferencesStore.getState().phaseModels, {});

  assert.equal(resolvePhaseModelRef("diagnosisLlm"), null);
  assert.equal(resolvePhaseModelRef("diagnosisLlm"), null);
  assert.equal(resolvePhaseModelRef("diagnosisLlm"), null);
  assert.deepEqual(resolvePhaseModelRef("requirements"), {
    providerID: "opencode-go",
    modelID: "hy3",
  });
});

test("el override de preferencias llega al pin de la fase CLI", () => {
  usePreferencesStore.getState().setPhaseModel("diagnosisLlm", {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
  });

  const diagnosisRef = resolvePhaseModelRef("diagnosisLlm");
  assert.deepEqual(diagnosisRef, {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
  });

  // Composición end-to-end: lo que iría en headlessArgs de opencode run.
  assert.deepEqual(runModelFlagArgs(diagnosisRef), [
    "--model",
    "anthropic/claude-sonnet-4-6",
  ]);
});

test("resetear el override (null) devuelve la fase a sin pin", () => {
  const store = usePreferencesStore.getState();

  store.setPhaseModel("diagnosisLlm", { providerID: "openai", modelID: "gpt-5.2" });
  assert.notEqual(resolvePhaseModelRef("diagnosisLlm"), null);

  store.setPhaseModel("diagnosisLlm", null);
  assert.equal(resolvePhaseModelRef("diagnosisLlm"), null);
});

// ─── Modo de ejecución CLI (headless vs TUI) ─────────────────────────────

test("phaseCliTui default false (headless garantiza el pin)", () => {
  assert.equal(usePreferencesStore.getState().phaseCliTui, false);
  assert.equal(shouldRunPhaseInTui(), false);

  usePreferencesStore.getState().setPhaseCliTui(true);
  assert.equal(shouldRunPhaseInTui(), true);
  assert.equal(
    JSON.parse(localStorage.getItem("termcanvas-preferences")!).phaseCliTui,
    true,
  );

  usePreferencesStore.getState().setPhaseCliTui(false);
});

// ─── Gate previo del pin CLI ─────────────────────────────────────────────

test("gate: modelo válido no bloquea; inválido devuelve el motivo", async () => {
  usePreferencesStore.getState().setPhaseModel("diagnosisLlm", {
    providerID: "opencode-go",
    modelID: "hy3",
  });

  const ok = await assertPhaseModelAvailable("diagnosisLlm", {
    validatePhase: async () => ({
      ok: true,
      data: { ok: true, phaseId: "diagnosisLlm", effective: null },
    }),
  });
  assert.equal(ok, null);

  const blocked = await assertPhaseModelAvailable("diagnosisLlm", {
    validatePhase: async () => ({
      ok: true,
      data: {
        ok: false,
        phaseId: "diagnosisLlm",
        effective: null,
        reason: 'El proveedor "fantasma" no está disponible.',
      },
    }),
  });
  assert.match(blocked!, /fantasma/);
});

test("gate: sin API o con catálogo caído NO bloquea (degrada best-effort)", async () => {
  // Sin API (undefined): deja pasar.
  assert.equal(await assertPhaseModelAvailable("diagnosisLlm", undefined), null);
  // Endpoint en error: deja pasar.
  assert.equal(
    await assertPhaseModelAvailable("diagnosisLlm", {
      validatePhase: async () => ({ ok: false, error: "server caído" }),
    }),
    null,
  );
  // Excepción del canal: deja pasar.
  assert.equal(
    await assertPhaseModelAvailable("diagnosisLlm", {
      validatePhase: async () => {
        throw new Error("boom");
      },
    }),
    null,
  );
});

// ─── Tail de salida ──────────────────────────────────────────────────────

test("extractOutputTail conserva las últimas N líneas y limpia ANSI/CR", () => {
  const ansi =
    "linea-1\r\n\x1b[31mroja\x1b[0m\r\nlinea-3\r\nlinea-4\r\nlinea-5   \r\n";
  // El strip ANSI deja 5 líneas; las últimas 3 son estas.
  const tail = extractOutputTail(ansi, 3);
  assert.equal(tail, "linea-3\nlinea-4\nlinea-5");
});

test("extractOutputTail con menos líneas de las pedidas devuelve todo", () => {
  assert.equal(extractOutputTail("a\nb", 15), "a\nb");
  assert.equal(extractOutputTail("", 15), "");
});
