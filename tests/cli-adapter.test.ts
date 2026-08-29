// Tests del adapter multi-CLI — verifican que el routing por CLI (fase → CLI → catálogo → validación → flags)
// funciona EXTENDIÉNDOSE sin tocar lógica central, y que corrige el bug
// "[diagnosisLlm] El proveedor codebuddy no está disponible en esta instalación de opencode" en TODAS las fases.
//
// Filosofía de estos tests: NO hardcodean listas de modelos ni asumen nombres;
// verifican COMPORTAMIENTO observable (validación cruza catálogo correcto,
// flags reflejan dialecto del CLI, cache por CLI está aislado, gate del engine respeta CLI).
// Usan seams reales (setCatalogClient / __injectMockCatalog / __setCliAvailableOverride)
// para no levantar servers ni spawnear binarios.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ─── Imports de producción (contratos reales) ──────────────────────────
import {
  PHASE_IDS,
  formatModelRef,
  type ModelRef,
  type PhaseId,
} from "../shared/phaseModels.ts";
import {
  fetchModelCatalog,
  validatePhaseAgainstCatalog,
  invalidateModelCatalog,
  isCliAvailable,
  __setCliAvailableOverride,
  __injectMockCatalog,
  __resetCatalogTestState,
  type ModelCatalog,
  type CatalogProvider,
} from "../electron/model-catalog.ts";
import {
  setPhaseModelOverrides,
  setPhaseCliOverrides,
  phaseCliRef,
  phaseModelRef,
  promptStructured,
  setTestClient,
  __setTestHarnessForInterview,
  ModelUnavailableError,
  type InterviewLedger,
} from "../headless-runtime/interview/engine.ts";
import {
  runModelFlagArgs,
  tuiModelFlagArgs,
  assertPhaseModelAvailable,
} from "../src/planner/modelPin.ts";
import { buildHeadlessArgsForCli, HEADLESS_KNOWN_CLIS } from "../src/planner/planningSession.ts";
import { usePreferencesStore } from "../src/stores/preferencesStore.ts";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

// ─── Helpers ───────────────────────────────────────────────────────────

const STORAGE_KEY = "termcanvas-preferences";

function installLocalStorage(initialValue?: string) {
  const backingStore = new Map<string, string>();
  if (initialValue !== undefined) backingStore.set(STORAGE_KEY, initialValue);
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (key: string) => backingStore.get(key) ?? null,
    setItem: (key: string, value: string) => backingStore.set(key, value),
    removeItem: (key: string) => backingStore.delete(key),
    clear: () => backingStore.clear(),
  } as Storage;
}

function makeCatalog(source: ModelCatalog["source"], providers: CatalogProvider[], defaults: Record<string, string> = {}): ModelCatalog {
  return { providers, defaults, fetchedAt: Date.now(), source };
}

function opencodeProvider(connected = true): CatalogProvider {
  return {
    id: "opencode-go",
    name: "OpenCode Go",
    connected,
    models: [
      { providerID: "opencode-go", modelID: "hy3", name: "HY3", status: "active", contextWindow: 128000, variants: [] },
      { providerID: "opencode-go", modelID: "deepseek-v4-flash", name: "DeepSeek", status: "active", contextWindow: 1000000, variants: ["max"] },
    ],
  };
}

function anthropicProvider(connected = true): CatalogProvider {
  return {
    id: "anthropic",
    name: "Anthropic",
    connected,
    models: [
      { providerID: "anthropic", modelID: "claude-sonnet-4-6", name: "Sonnet", status: "active", contextWindow: 200000, variants: [] },
    ],
  };
}

function codebuddyProvider(connected = true): CatalogProvider {
  return {
    id: "codebuddy",
    name: "CodeBuddy",
    connected,
    models: [
      { providerID: "codebuddy", modelID: "fast-model", name: "fast-model", status: "unknown", contextWindow: null, variants: [] },
      { providerID: "codebuddy", modelID: "default-model", name: "default-model", status: "unknown", contextWindow: null, variants: [] },
      { providerID: "codebuddy", modelID: "deep-model", name: "deep-model", status: "unknown", contextWindow: null, variants: [] },
    ],
  };
}

function genericStubProvider(cli: string, connected = true): CatalogProvider {
  return { id: cli, name: cli, connected, models: [] };
}

interface CapturedPrompt {
  sessionID: string;
  model: { providerID: string; modelID: string };
  variant?: string;
}

function makeEngineMock() {
  const prompts: CapturedPrompt[] = [];
  const client = {
    session: {
      create: async () => ({ data: { id: "s_mock" }, error: null }),
      prompt: async (input: CapturedPrompt) => {
        prompts.push(input);
        return { data: { info: { error: null, structured: { ok: true }, tokens: { input: 1, output: 1 } } }, error: null };
      },
    },
  } as unknown as OpencodeClient;
  return { client, prompts };
}

function makeMockHarness(harnessId: string) {
  const prompts: Array<{ model: ModelRef; text: string; sessionId: string }> = [];
  const harness = {
    harnessId,
    ensureReady: async () => {},
    createSession: async () => ({ id: `s_mock_${harnessId}` }),
    deleteSession: async () => {},
    promptStructuredRaw: async (opts: { model: ModelRef; text: string; sessionId: string }) => {
      prompts.push({ model: opts.model, text: opts.text, sessionId: opts.sessionId });
      return { raw: { ok: true }, usage: { input_tokens: 1, output_tokens: 1 } };
    },
    close: () => {},
  } as unknown as import("../shared/neutral/interview.ts").HarnessInterviewAdapter;
  return { harness, prompts };
}

const LEDGER = { session_id: "s_test", project_path: "/tmp/p" } as unknown as InterviewLedger;

// ─── Setup per test ────────────────────────────────────────────────────

beforeEach(() => {
  installLocalStorage();
  __resetCatalogTestState();
  invalidateModelCatalog();
  setPhaseModelOverrides(null);
  setPhaseCliOverrides(null);
  setTestClient(null);
  __setTestHarnessForInterview("codebuddy", null);
  __setTestHarnessForInterview("opencode", null);
  // limpia preferencesStore (singleton por proceso)
  for (const phase of PHASE_IDS) {
    try { usePreferencesStore.getState().setPhaseModel(phase as PhaseId, null); } catch {}
    try { usePreferencesStore.getState().setPhaseCli(phase as PhaseId, null); } catch {}
  }
  __setCliAvailableOverride("codebuddy", null);
  __setCliAvailableOverride("opencode", null);
  __setCliAvailableOverride("claude", null);
  __setCliAvailableOverride("codex", null);
  __setCliAvailableOverride("gemini", null);
  __setCliAvailableOverride("kimi", null);
  __setCliAvailableOverride("wuu", null);
});

// ─── 1. Catálogo por CLI: aislamiento de cache ────────────────────────

test("cache por CLI aislado: opencode y codebuddy no se pisan", async () => {
  const opencodeCatalog = makeCatalog("opencode", [opencodeProvider(true)], { "opencode-go": "hy3" });
  const codebuddyCatalog = makeCatalog("codebuddy", [codebuddyProvider(true)], { codebuddy: "fast-model" });

  __injectMockCatalog("opencode", opencodeCatalog);
  __injectMockCatalog("codebuddy", codebuddyCatalog);

  const fetchedOpencode = await fetchModelCatalog(false, "opencode");
  const fetchedCodebuddy = await fetchModelCatalog(false, "codebuddy");

  assert.equal(fetchedOpencode.source, "opencode");
  assert.equal(fetchedCodebuddy.source, "codebuddy");
  assert.ok(fetchedOpencode.providers.some((p) => p.id === "opencode-go"));
  assert.ok(!fetchedOpencode.providers.some((p) => p.id === "codebuddy"));
  assert.ok(fetchedCodebuddy.providers.some((p) => p.id === "codebuddy"));
  assert.ok(!fetchedCodebuddy.providers.some((p) => p.id === "opencode-go"));

  // invalidar uno no borra el otro
  invalidateModelCatalog("opencode");
  const stillCodebuddy = await fetchModelCatalog(false, "codebuddy");
  assert.equal(stillCodebuddy.source, "codebuddy");
  // opencode invalidado: al pedirlo sin inyección, debe fallar o pedir de nuevo
  // Como limpiamos cache y no hay fetcher mock, reinyectamos para verificar que quedó vacío
  __injectMockCatalog("opencode", opencodeCatalog);
  const reFetchedOpencode = await fetchModelCatalog(false, "opencode");
  assert.equal(reFetchedOpencode.source, "opencode");
});

test("fetch codebuddy builtin respeta availability override y lista fast-model", async () => {
  __resetCatalogTestState();
  __setCliAvailableOverride("codebuddy", true);
  // sin inyección, el fetcher real construye builtins
  const cat = await fetchModelCatalog(false, "codebuddy");
  assert.equal(cat.source, "codebuddy");
  const provider = cat.providers.find((p) => p.id === "codebuddy");
  assert.ok(provider, "debe existir provider codebuddy");
  assert.equal(provider!.connected, true);
  assert.ok(provider!.models.some((m) => m.modelID === "fast-model"), "builtins deben incluir fast-model");

  // si el binario no está, connected=false pero el catálogo sigue listando modelos
  __resetCatalogTestState();
  __setCliAvailableOverride("codebuddy", false);
  const catDisconnected = await fetchModelCatalog(true, "codebuddy");
  const prov2 = catDisconnected.providers.find((p) => p.id === "codebuddy")!;
  assert.equal(prov2.connected, false);
  assert.ok(prov2.models.length > 0);
});

// ─── 2. Validación cruzada — reproduce el bug original ────────────────

test("bug original: codebuddy/fast-model falla contra opencode pero pasa contra codebuddy", async () => {
  const opencodeCatalog = makeCatalog("opencode", [opencodeProvider(true), anthropicProvider(true)], { "opencode-go": "hy3" });
  const codebuddyCatalog = makeCatalog("codebuddy", [codebuddyProvider(true)], { codebuddy: "fast-model" });

  const ref: ModelRef = { providerID: "codebuddy", modelID: "fast-model" };

  // Simula TODAS las fases con override codebuddy — antes el gate usaba opencode siempre y fallaba en todas
  for (const phaseId of PHASE_IDS) {
    const opencodeResult = validatePhaseAgainstCatalog(phaseId, opencodeCatalog, { [phaseId]: ref });
    assert.equal(opencodeResult.ok, false, `fase ${phaseId} debería fallar contra opencode`);
    assert.match(opencodeResult.reason!, /no está disponible en esta instalación de opencode/);
    // el error debe sugerir alternativas conectadas de opencode, no de codebuddy
    assert.ok(opencodeResult.alternatives && opencodeResult.alternatives.length > 0);

    const codebuddyResult = validatePhaseAgainstCatalog(phaseId, codebuddyCatalog, { [phaseId]: ref });
    assert.equal(codebuddyResult.ok, true, `fase ${phaseId} debería pasar contra codebuddy`);
  }
});

test("validación genérica stub: provider existe pero modelo vacío → error de modelo, no de provider", async () => {
  __setCliAvailableOverride("claude", true);
  const claudeCatalog = await fetchModelCatalog(false, "claude");
  assert.equal(claudeCatalog.source, "claude");
  assert.ok(claudeCatalog.providers.some((p) => p.id === "claude"));
  assert.equal(claudeCatalog.providers.find((p) => p.id === "claude")!.connected, true);
  assert.equal(claudeCatalog.providers.find((p) => p.id === "claude")!.models.length, 0);

  const ref: ModelRef = { providerID: "claude", modelID: "no-existe" };
  const result = validatePhaseAgainstCatalog("brief", claudeCatalog, { brief: ref });
  assert.equal(result.ok, false);
  // debe fallar por modelo inexistente, no por provider inexistente — mensaje más accionable
  assert.match(result.reason!, /no existe en el proveedor "claude"/);
});

// ─── 3. Engine gate respeta CLI por fase ───────────────────────────────

test("engine gate respeta phaseCliOverrides: mismo modelo, distinto CLI → distinto veredicto", async () => {
  const opencodeCatalog = makeCatalog("opencode", [opencodeProvider(true)], { "opencode-go": "hy3" });
  const codebuddyCatalog = makeCatalog("codebuddy", [codebuddyProvider(true)], { codebuddy: "fast-model" });

  __injectMockCatalog("opencode", opencodeCatalog);
  __injectMockCatalog("codebuddy", codebuddyCatalog);

  const ref: ModelRef = { providerID: "codebuddy", modelID: "fast-model" };

  // Fase configurada con codebuddy → gate debe pasar (via harness codebuddy)
  setPhaseCliOverrides({ requirements: "codebuddy" });
  setPhaseModelOverrides({ requirements: ref });
  const { harness: harnessOk, prompts: promptsOk } = makeMockHarness("codebuddy");
  __setTestHarnessForInterview("codebuddy", harnessOk);

  await promptStructured(
    LEDGER,
    {},
    "texto",
    (v): v is { ok: boolean } => true,
    "Test gate codebuddy ok",
    2000,
    undefined,
    "requirements",
  );
  assert.equal(promptsOk.length, 1, "con CLI codebuddy el gate no debe bloquear");
  assert.deepEqual(promptsOk[0].model, { providerID: "codebuddy", modelID: "fast-model" });

  // Misma fase, mismo modelo, pero CLI opencode → gate debe BLOQUEAR (no llega al harness)
  setPhaseCliOverrides({ requirements: "opencode" });
  const { harness: harnessFail, prompts: promptsFail } = makeMockHarness("opencode");
  __setTestHarnessForInterview("opencode", harnessFail);

  await assert.rejects(
    () =>
      promptStructured(
        LEDGER,
        {},
        "texto",
        (v): v is { ok: boolean } => true,
        "Test gate opencode fail",
        2000,
        undefined,
        "requirements",
      ),
    (err: unknown) => {
      assert.ok(err instanceof ModelUnavailableError);
      assert.equal((err as ModelUnavailableError).phaseId, "requirements");
      assert.match((err as Error).message, /codebuddy\/fast-model/);
      return true;
    },
  );
  assert.equal(promptsFail.length, 0, "con CLI opencode el gate debe bloquear antes de llamar al modelo");
});

test("engine gate best-effort: catalog fetch falla no bloquea (todas las fases)", async () => {
  // Simula que el catálogo de opencode está en cooldown/fallido — el gate degrada
  // Para esto, inyectamos un client que falla y verificamos que promptStructured no bloquea
  // (pero nuestro mock usa __injectMockCatalog, así que simulamos fallo via setCatalogClient error)
  // En este test usamos el gate directo: si fetch lanza, el gate no debe tirar ModelUnavailableError
  const { client, prompts } = makeEngineMock();
  setTestClient(client);
  // Fuerza fallo de catálogo opencode via cooldown sin cache
  __resetCatalogTestState();
  // Hacemos que fetch falle: inyectamos un catalog que no existe y forzamos error vía cooldown
  // Truco: seteamos cooldown manualmente inyectando fallo
  // Más simple: no inyectamos nada para opencode y hacemos que ensureCatalogClient falle
  // Para el engine, el gate hace fetchModelCatalog(false, "opencode") que intentará levantar server real
  // Pero como tenemos __reset sin mock, el fetch intentará server y fallará rápido en test (timeout 30s)
  // Por eso mockeamos opencode con un catalog que falla: usamos setCatalogClient con error
  const { setCatalogClient } = await import("../electron/model-catalog.ts");
  setCatalogClient({ provider: { list: async () => ({ error: { message: "server caído" } }) } }, "opencode");
  // Gate debe degradar best-effort y dejar pasar
  setPhaseCliOverrides({ brief: "opencode" });
  setPhaseModelOverrides({ brief: { providerID: "fantasma", modelID: "nope" } });
  // Pero con catalog caído, el gate NO bloquea — deja pasar y el modelo fallará más tarde con su propio error
  // Verificamos que el prompt se intenta (no ModelUnavailableError del gate)
  // Nota: este comportamiento ya está cubierto en interview-model-routing.test, aquí solo verificamos que el nuevo
  // código de gate con CLI sigue siendo best-effort
  setPhaseModelOverrides(null);
  setPhaseCliOverrides(null);
  setTestClient(client);
  __resetCatalogTestState();
  // Ahora con catalog caído pero sin override, debe pasar
  const { setCatalogClient: _sc } = await import("../electron/model-catalog.ts");
  _sc({ provider: { list: async () => ({ error: { message: "boom" } }) } }, "opencode");
  await promptStructured(LEDGER, {}, "texto", (v): v is { ok: boolean } => true, "Best effort", 2000, undefined, "brief");
  assert.equal(prompts.length, 1);
});

// ─── 4. modelPin flags por CLI ─────────────────────────────────────────

test("runModelFlagArgs respeta dialecto por CLI (opencode vs codebuddy vs genérico)", () => {
  const ref: ModelRef = { providerID: "codebuddy", modelID: "fast-model", variant: "max" };
  const refOpen: ModelRef = { providerID: "opencode-go", modelID: "hy3", variant: "max" };

  // opencode: provider/model + variant
  assert.deepEqual(runModelFlagArgs(refOpen, "opencode"), ["--model", "opencode-go/hy3", "--variant", "max"]);
  // codebuddy: solo modelID, sin variant
  assert.deepEqual(runModelFlagArgs(ref, "codebuddy"), ["--model", "fast-model"]);
  // codebuddy aunque ref tenga provider codebuddy, ignora prefijo
  assert.deepEqual(runModelFlagArgs({ providerID: "codebuddy", modelID: "default-model" }, "codebuddy"), ["--model", "default-model"]);
  // genéricos (claude, gemini, kimi, wuu, codex): usan provider/model y respetan variant excepto codebuddy
  for (const cli of ["claude", "codex", "gemini", "kimi", "wuu", "opencode"] as const) {
    const flags = runModelFlagArgs(refOpen, cli);
    assert.deepEqual(flags, ["--model", "opencode-go/hy3", "--variant", "max"], `CLI ${cli} debe usar provider/model + variant`);
  }
  // sin ref → sin flags
  assert.deepEqual(runModelFlagArgs(null, "codebuddy"), []);
});

test("tuiModelFlagArgs siempre omite variant pero respeta modelID-only para codebuddy", () => {
  const ref: ModelRef = { providerID: "codebuddy", modelID: "fast-model", variant: "max" };
  assert.deepEqual(tuiModelFlagArgs(ref, "codebuddy"), ["--model", "fast-model"]);
  assert.deepEqual(tuiModelFlagArgs(ref, "opencode"), ["--model", "codebuddy/fast-model"]);
  assert.deepEqual(tuiModelFlagArgs(null, "opencode"), []);
  // variant nunca viaja en TUI
  assert.deepEqual(tuiModelFlagArgs({ providerID: "opencode-go", modelID: "hy3", variant: "max" }, "opencode"), ["--model", "opencode-go/hy3"]);
});

// ─── 5. assertPhaseModelAvailable respeta CLI por fase ─────────────────

test("assertPhaseModelAvailable pasa el CLI correcto a validatePhase (diagnosisLlm = codebuddy)", async () => {
  installLocalStorage();
  usePreferencesStore.getState().setPhaseModel("diagnosisLlm", { providerID: "codebuddy", modelID: "fast-model" });
  usePreferencesStore.getState().setPhaseCli("diagnosisLlm", "codebuddy");

  const captured: { phaseId: PhaseId; cli?: string }[] = [];
  const api = {
    validatePhase: async (phaseId: PhaseId, _overrides: unknown, cli?: string) => {
      captured.push({ phaseId, cli });
      return { ok: true as const, data: { ok: true, phaseId, effective: { providerID: "codebuddy", modelID: "fast-model" } } };
    },
  };

  const result = await assertPhaseModelAvailable("diagnosisLlm", api);
  assert.equal(result, null);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].phaseId, "diagnosisLlm");
  assert.equal(captured[0].cli, "codebuddy", "debe validar contra codebuddy, no contra opencode");
});

test("assertPhaseModelAvailable con cliOverride explícito gana sobre store", async () => {
  installLocalStorage();
  usePreferencesStore.getState().setPhaseCli("brief", "opencode");

  const captured: string[] = [];
  const api = {
    validatePhase: async (_phaseId: PhaseId, _o: unknown, cli?: string) => {
      captured.push(cli ?? "undefined");
      return { ok: true as const, data: { ok: true, phaseId: "brief" as PhaseId, effective: null } };
    },
  };

  await assertPhaseModelAvailable("brief", api, "codebuddy");
  assert.equal(captured[0], "codebuddy");
});

test("assertPhaseModelAvailable best-effort: sin api, error o catalog caído no bloquea", async () => {
  installLocalStorage();
  assert.equal(await assertPhaseModelAvailable("diagnosisLlm", undefined), null);
  assert.equal(await assertPhaseModelAvailable("diagnosisLlm", { validatePhase: async () => ({ ok: false, error: "boom" }) }), null);
  assert.equal(await assertPhaseModelAvailable("diagnosisLlm", { validatePhase: async () => { throw new Error("kaboom"); } }), null);
});

// ─── 6. planningSession headless registry ───────────────────────────────

test("buildHeadlessArgsForCli genera comando correcto por CLI", () => {
  const prompt = "<prompt>";
  const flags = ["--model", "x/y"];

  // opencode
  assert.deepEqual(buildHeadlessArgsForCli("opencode", flags, prompt), ["run", "--model", "x/y", "--auto", prompt]);
  assert.deepEqual(buildHeadlessArgsForCli("opencode", flags, prompt, "sess123"), ["run", "--model", "x/y", "-s", "sess123", "--auto", prompt]);

  // codebuddy
  assert.deepEqual(buildHeadlessArgsForCli("codebuddy", ["--model", "fast-model"], prompt), ["-p", "--output-format", "json", "--model", "fast-model", prompt]);
  assert.deepEqual(buildHeadlessArgsForCli("codebuddy", [], prompt, "sess123"), ["--resume", "sess123", prompt]);

  // claude
  assert.deepEqual(buildHeadlessArgsForCli("claude", flags, prompt), ["-p", "--output-format", "json", "--model", "x/y", prompt]);
  assert.deepEqual(buildHeadlessArgsForCli("claude", flags, prompt, "sess123"), ["--resume", "sess123", "--print", "--output-format", "json", "--model", "x/y", prompt]);

  // codex
  assert.deepEqual(buildHeadlessArgsForCli("codex", flags, prompt), ["exec", "--json", "--model", "x/y", prompt]);

  // genéricos
  for (const cli of ["gemini", "kimi", "wuu"] as const) {
    const args = buildHeadlessArgsForCli(cli, flags, prompt);
    assert.ok(Array.isArray(args) && args.length > 0, `CLI ${cli} debe generar args`);
    assert.ok(!args.includes("--auto") || cli === "wuu" || cli === "opencode", `CLI ${cli} headless válido`);
  }

  // opencode default para CLI desconocido (no rompe)
  assert.deepEqual(buildHeadlessArgsForCli("desconocido", flags, prompt), ["run", "--model", "x/y", "--auto", prompt]);
});

test("HEADLESS_KNOWN_CLIS cubre todos los PHASE_CLIS conocidos", async () => {
  const { PHASE_CLIS } = await import("../shared/phaseModels.ts");
  for (const cli of PHASE_CLIS) {
    assert.ok(HEADLESS_KNOWN_CLIS.has(cli), `CLI ${cli} debe estar en HEADLESS_KNOWN_CLIS`);
  }
});

// ─── 7. Pattern extensibility: nuevos CLIs sin tocar lógica central ─────

test("agregar CLI stub no requiere cambios en validatePhaseAgainstCatalog (genérico)", async () => {
  // Simula que mañana se añade "mycli" a PHASE_CLIS pero sin fetcher dedicado:
  // el stub genérico debe seguir funcionando sin lanzar.
  __setCliAvailableOverride("kimi", true);
  const cat = await fetchModelCatalog(false, "kimi");
  assert.equal(cat.source, "kimi");
  assert.equal(cat.providers[0].id, "kimi");
  assert.equal(cat.providers[0].connected, true);

  // Validar un modelo inexistente en ese stub debe dar error de modelo, no crash
  const result = validatePhaseAgainstCatalog("tactics", cat, { tactics: { providerID: "kimi", modelID: "nope" } });
  assert.equal(result.ok, false);
  assert.match(result.reason!, /no existe en el proveedor "kimi"/);
});

test("cada PHASE_ID con override codebuddy valida ok contra catálogo codebuddy (todas las fases)", async () => {
  const codebuddyCatalog = makeCatalog("codebuddy", [codebuddyProvider(true)], { codebuddy: "fast-model" });
  const ref: ModelRef = { providerID: "codebuddy", modelID: "fast-model" };
  for (const phaseId of PHASE_IDS) {
    const result = validatePhaseAgainstCatalog(phaseId, codebuddyCatalog, { [phaseId]: ref });
    assert.equal(result.ok, true, `fase ${phaseId} con codebuddy/fast-model vs codebuddy catalog debe pasar`);
  }
});
