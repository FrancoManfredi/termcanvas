// Tests del routing de modelo por fase en el motor de entrevista (WU4).
// Cliente de modelo MOCKEADO vía setTestClient y catálogo MOCKEADO vía
// setCatalogClient: nada corre contra un modelo ni un server real.
//
// Cubre: sync-guard constantes del motor vs contrato compartido,
// resolución phaseModelRef (override > default > fallback CLI),
// threading del ref resuelto al payload real de session.prompt,
// y el gate de disponibilidad (bloquea con ModelUnavailableError cuando
// el catálogo es sano; NO bloquea cuando el catálogo mismo falla).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import {
  promptStructured,
  setTestClient,
  setPhaseModelOverrides,
  setPhaseActivityListener,
  phaseModelRef,
  ModelUnavailableError,
  DEFAULT_PROVIDER_ID,
  DEFAULT_MODEL_ID,
  HEAVY_MODEL_ID,
  SYNTHESIS_MODEL,
  GAP_CHECK_MODEL,
  type ModelRef,
  type PhaseId,
  type InterviewLedger,
} from "../headless-runtime/interview/engine.ts";
import {
  DEFAULT_PHASE_MODELS,
  SYNTHESIS_VARIANT,
  type ModelRef as SharedModelRef,
} from "../shared/phaseModels.ts";
import { setCatalogClient } from "../electron/model-catalog.ts";

// ─── Harness ─────────────────────────────────────────────────────────────

interface CapturedPrompt {
  sessionID: string;
  model: { providerID: string; modelID: string };
  variant?: string;
}

function makeEngineMock() {
  const prompts: CapturedPrompt[] = [];
  const client = {
    session: {
      create: async () => ({ data: { id: "s_nueva" }, error: null }),
      prompt: async (input: CapturedPrompt) => {
        prompts.push(input);
        return {
          data: {
            info: {
              error: null,
              structured: { ok: true },
              tokens: { input: 3, output: 4 },
            },
          },
          error: null,
        };
      },
    },
  };
  return { client: client as unknown as OpencodeClient, prompts };
}

// Catálogo sano mínimo: opencode-go conectado (hy3 + deepseek con variant
// max) y anthropic conectado (un claude). Sin proveedores desconectados.
const CATALOGO_SANO = {
  all: [
    {
      id: "opencode-go",
      name: "OpenCode Go",
      models: {
        hy3: { status: "active", limit: { context: 128000 }, variants: {} },
        "deepseek-v4-flash": {
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
      },
    },
  ],
  default: { "opencode-go": "hy3", anthropic: "claude-sonnet-4-6" },
  connected: ["opencode-go", "anthropic"],
};

function instalarCatalogoSano(): void {
  setCatalogClient({
    provider: { list: async () => ({ data: CATALOGO_SANO }) },
  });
}

const LEDGER = {
  session_id: "s_mock",
  project_path: "/tmp/proyecto",
} as unknown as InterviewLedger;

async function llamarDirecto(
  prompts: CapturedPrompt[],
  phaseId?: PhaseId,
  model?: ModelRef,
): Promise<void> {
  await promptStructured(
    LEDGER,
    {},
    "texto de prueba",
    (v): v is { ok: boolean } => typeof v === "object" && v !== null && "ok" in v,
    "Test routing",
    1000,
    model,
    phaseId,
  );
  assert.equal(prompts.length, 1);
}

beforeEach(() => {
  setPhaseModelOverrides(null);
  // TODO test arranca con catálogo sano mockeado: sin esto, el gate
  // levantaría un server REAL de opencode y validarían contra la
  // instalación local (lento y no determinista).
  instalarCatalogoSano();
});

// ─── Sync guard: constantes del motor vs contrato compartido ─────────────

test("constantes del motor sincronizadas con shared/phaseModels", () => {
  assert.equal(DEFAULT_PROVIDER_ID, "opencode-go");
  assert.equal(DEFAULT_MODEL_ID, "hy3");
  assert.deepEqual(SYNTHESIS_MODEL, DEFAULT_PHASE_MODELS.synthesis);
  assert.deepEqual(GAP_CHECK_MODEL, DEFAULT_PHASE_MODELS.gapCheck);
  // El heavy y la variant coinciden entre ambos lados.
  const synthShared = DEFAULT_PHASE_MODELS.synthesis as SharedModelRef;
  assert.equal(synthShared.modelID, HEAVY_MODEL_ID);
  assert.equal(synthShared.variant, SYNTHESIS_VARIANT);
});

// ─── Resolución phaseModelRef ────────────────────────────────────────────

test("phaseModelRef sin overrides devuelve los defaults por fase", () => {
  assert.deepEqual(phaseModelRef("requirements"), {
    providerID: "opencode-go",
    modelID: "hy3",
  });
  assert.deepEqual(phaseModelRef("brief"), { providerID: "opencode-go", modelID: "hy3" });
  assert.deepEqual(phaseModelRef("asrReview"), { providerID: "opencode-go", modelID: "hy3" });
  assert.deepEqual(phaseModelRef("gapCheck"), {
    providerID: "opencode-go",
    modelID: HEAVY_MODEL_ID,
  });
  assert.deepEqual(phaseModelRef("synthesis"), {
    providerID: "opencode-go",
    modelID: HEAVY_MODEL_ID,
    variant: "max",
  });
});

test("phaseModelRef: fases CLI (default null) caen al turno del motor", () => {
  for (const fase of [
    "plannerRoadmap",
    "plannerAudit",
    "diagnosisLlm",
  ] as PhaseId[]) {
    assert.deepEqual(phaseModelRef(fase), {
      providerID: "opencode-go",
      modelID: "hy3",
    });
  }
});

test("phaseModelRef: el override del usuario gana", () => {
  const override: ModelRef = { providerID: "anthropic", modelID: "claude-sonnet-4-6" };
  setPhaseModelOverrides({ requirements: override });
  assert.deepEqual(phaseModelRef("requirements"), override);
  // Las demás fases siguen con su default.
  assert.deepEqual(phaseModelRef("brief"), { providerID: "opencode-go", modelID: "hy3" });
});

// ─── Threading al payload real ───────────────────────────────────────────

test("promptStructured sin override manda el default hy3 sin variant", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);

  await llamarDirecto(prompts, "requirements");

  assert.deepEqual(prompts[0].model, { providerID: "opencode-go", modelID: "hy3" });
  assert.equal(prompts[0].variant, undefined);
});

test("promptStructured threadea el override del usuario al payload", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);
  setPhaseModelOverrides({
    requirements: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
  });

  await llamarDirecto(prompts, "requirements");

  assert.deepEqual(prompts[0].model, {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
  });
});

test("la síntesis usa el default heavy con variant max", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);

  await llamarDirecto(
    prompts,
    "synthesis",
    phaseModelRef("synthesis"),
  );

  assert.deepEqual(prompts[0].model, { providerID: "opencode-go", modelID: HEAVY_MODEL_ID });
  assert.equal(prompts[0].variant, "max");
});

test("override de synthesis reemplaza modelo Y variant juntos", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);
  setPhaseModelOverrides({
    synthesis: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
  });

  await llamarDirecto(prompts, "synthesis", phaseModelRef("synthesis"));

  assert.deepEqual(prompts[0].model, {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
  });
  assert.equal(prompts[0].variant, undefined);
});

// ─── Gate de disponibilidad ──────────────────────────────────────────────

test("gate OK: modelo presente y autenticado deja pasar la llamada", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);

  await llamarDirecto(prompts, "requirements");
  assert.equal(prompts.length, 1);
});

test("gate bloquea con ModelUnavailableError ante modelo inexistente", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);
  setPhaseModelOverrides({
    brief: { providerID: "fantasma", modelID: "nope" },
  });

  await assert.rejects(
    () => llamarDirecto(prompts, "brief", phaseModelRef("brief")),
    (err: unknown) => {
      assert.ok(err instanceof ModelUnavailableError);
      assert.equal(err.phaseId, "brief");
      assert.match(err.message, /fantasma\/nope/);
      // Alternativas accionables de proveedores CONECTADOS.
      assert.ok(err.alternatives.length > 0);
      assert.ok(err.alternatives.some((a: string) => a.startsWith("anthropic/")));
      return true;
    },
  );
  // Nada se llamó: falló ANTES de gastar la llamada.
  assert.equal(prompts.length, 0);
});

test("gate bloquea variant insoportada para el modelo elegido", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);

  await assert.rejects(
    () =>
      llamarDirecto(prompts, "synthesis", {
        providerID: "opencode-go",
        modelID: "deepseek-v4-flash",
        variant: "ultra",
      }),
    (err: unknown) => {
      assert.ok(err instanceof ModelUnavailableError);
      assert.match(err.message, /variant "ultra"/);
      return true;
    },
  );
  assert.equal(prompts.length, 0);
});

test("gate best-effort: catálogo caído NO bloquea la llamada", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);
  setCatalogClient({
    provider: { list: async () => ({ error: { message: "server caído" } }) },
  });

  await llamarDirecto(prompts, "requirements");
  assert.equal(prompts.length, 1);
});

// ─── Feed de actividad (start/end por llamada) ───────────────────────────

test("promptStructured emite start y end con ref, timing y usage", async () => {
  const { client, prompts } = makeEngineMock();
  setTestClient(client);

  const events: import("../../shared/phaseModels.ts").PhaseActivityEvent[] = [];
  setPhaseActivityListener((event) => events.push(event));
  try {
    await llamarDirecto(prompts, "synthesis", phaseModelRef("synthesis"));
  } finally {
    setPhaseActivityListener(null);
  }

  assert.equal(events.length, 2);
  const [start, end] = events;
  assert.equal(start.kind, "start");
  assert.equal(start.phaseId, "synthesis");
  assert.deepEqual(start.modelRef, {
    providerID: "opencode-go",
    modelID: HEAVY_MODEL_ID,
    variant: "max",
  });
  assert.equal(end.kind, "end");
  assert.ok((end.durationMs ?? 0) >= 0);
  assert.deepEqual(end.usage, { input_tokens: 3, output_tokens: 4 });
  assert.equal(end.error, undefined);
});

test("feed: error de la llamada emite end con el mensaje", async () => {
  const failing: import("@opencode-ai/sdk/v2").OpencodeClient = {
    session: {
      create: async () => ({ data: { id: "s1" }, error: null }),
      prompt: async () => ({ error: { message: "kaboom" } }),
    },
  } as unknown as typeof failing;
  setTestClient(failing);

  const events: import("../../shared/phaseModels.ts").PhaseActivityEvent[] = [];
  setPhaseActivityListener((event) => events.push(event));
  try {
    await assert.rejects(() =>
      promptStructured(
        LEDGER,
        {},
        "texto",
        (v): v is { ok: boolean } => true,
        "Test feed",
        1000,
        phaseModelRef("requirements"),
        "requirements",
      ),
    );
  } finally {
    setPhaseActivityListener(null);
  }

  assert.equal(events.length, 2);
  assert.equal(events[1].kind, "end");
  assert.match(events[1].error ?? "", /falló|kaboom/);
});
