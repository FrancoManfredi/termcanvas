// Catálogo de modelos disponibles de opencode — fuente de verdad para el
// routing de modelos por fase (shared/phaseModels.ts) y para la UI de
// Settings (WU6).
//
// Qué expone el server de opencode (endpoint provider.list del SDK):
//   - all: proveedores visibles, cada uno con su diccionario de models
//     (id, name, status, limit.context, variants).
//   - connected: proveedores con auth resuelta (los únicos llamables).
//   - default: modelo default por proveedor — preselección natural en UI.
//
// Decisiones de diseño:
//   - Server EFÍMERO propio, desacoplado del server del motor de entrevista:
//     cerrar una entrevista no debe matar el catálogo y viceversa. Mismo
//     patrón de puerto alto aleatorio que engine.ts (el puerto 0 mapea al
//     default 4096 y colisiona con restos huérfanos de otras sesiones).
//   - Cache TTL: levantar un server es caro (spawn + handshake); el catálogo
//     se consulta al validar fases y al abrir Settings, no por tecla.
//   - Normalización DEFENSIVA del crudo del SDK: este módulo existe justo
//     para absorber la deriva de versión del server sin romper la app.
//   - Este archivo NO importa "electron": es lógica pura testeable en node.
//     La registración IPC vive en model-catalog-ipc.ts.

import {
  createOpencodeClient,
  createOpencodeServer,
} from "@opencode-ai/sdk/v2";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import {
  PHASE_IDS,
  resolveModelForPhase,
  formatModelRef,
  type ModelRef,
  type PhaseId,
} from "../shared/phaseModels";

// ─── Tipos públicos (canónicos en shared, re-exportados por compat) ──────

import type {
  CatalogModel,
  CatalogProvider,
  CatalogResult,
  ModelCatalog,
  PhaseValidation,
} from "../shared/modelCatalog";
export type {
  CatalogModel,
  CatalogProvider,
  CatalogResult,
  ModelCatalog,
  PhaseValidation,
};

// ─── Formas crudas del SDK (estructurales, a prueba de deriva de versión) ─

interface RawModel {
  id?: unknown;
  providerID?: unknown;
  name?: unknown;
  status?: unknown;
  variants?: unknown;
  limit?: { context?: unknown } | null;
}

interface RawProvider {
  id?: unknown;
  name?: unknown;
  models?: Record<string, RawModel> | null;
}

interface RawListResult {
  all?: RawProvider[] | null;
  default?: Record<string, string> | null;
  connected?: string[] | null;
}

/**
 * Seam estructural mínimo: el cliente real del SDK lo satisface tal cual y
 * los tests inyectan un mock liviano sin depender de tipos generados.
 */
export interface CatalogClient {
  provider: {
    list(): Promise<{ data?: RawListResult | null; error?: unknown }>;
  };
}

// ─── Server efímero propio + cache ───────────────────────────────────────

const CATALOG_SERVER_TIMEOUT_MS = 30_000;
const CATALOG_SERVER_RETRIES = 2;
const CATALOG_TTL_MS = 5 * 60 * 1000;
// Cooldown tras un fallo de obtención: sin esto, cada llamada gateada
// reintentaría levantar server (hasta ~60s por llamada) — el gate debe
// degradar RÁPIDO a "omitido" cuando opencode no responde, sin volverse el
// cuello de botella del motor.
const CATALOG_FAILURE_COOLDOWN_MS = 60_000;

let runningServer: { url: string; close: () => void } | null = null;
let runningClient: CatalogClient | null = null;
let cachedCatalog: ModelCatalog | null = null;
let inFlight: Promise<ModelCatalog> | null = null;
let cooldownUntil = 0;

/**
 * Seam de tests: inyecta un cliente falso y descarta cualquier server real.
 * Espejo de setTestClient del motor de entrevista.
 */
export function setCatalogClient(client: CatalogClient | null): void {
  if (runningServer) {
    runningServer.close();
    runningServer = null;
  }
  runningClient = client;
  invalidateModelCatalog();
}

async function ensureCatalogClient(): Promise<CatalogClient> {
  if (runningClient) return runningClient;
  let lastError: unknown;
  for (let attempt = 0; attempt < CATALOG_SERVER_RETRIES; attempt++) {
    try {
      const server = await createOpencodeServer({
        hostname: "127.0.0.1",
        // Puerto alto ALEATORIO, nunca 0: `opencode serve --port=0` mapea al
        // default 4096 y un server huérfano de otra sesión cuelga el arranque
        // hasta el timeout (lección ya aprendida en engine.ts).
        port: 20000 + Math.floor(Math.random() * 45000),
        timeout: CATALOG_SERVER_TIMEOUT_MS,
      });
      runningServer = server;
      runningClient = createOpencodeClient({ baseUrl: server.url }) as CatalogClient;
      return runningClient;
    } catch (err) {
      lastError = err;
      console.warn(
        `[model-catalog] no se pudo arrancar el server de opencode (intento ${attempt + 1}/${CATALOG_SERVER_RETRIES}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No se pudo arrancar el server de opencode para el catálogo.");
}

export function closeCatalogServer(): void {
  if (runningServer) {
    runningServer.close();
    runningServer = null;
  }
  runningClient = null;
  invalidateModelCatalog();
}

export function invalidateModelCatalog(): void {
  cachedCatalog = null;
  // Invalidar es "refrescá por favor" (setCatalogClient en tests, botón
  // refresh en Settings): limpia el cooldown para permitir reintento ya.
  cooldownUntil = 0;
}

// ─── Normalización defensiva ─────────────────────────────────────────────

function normalizeVariants(variants: unknown): string[] {
  if (!variants || typeof variants !== "object") return [];
  return Object.keys(variants as Record<string, unknown>).filter(
    (k) => k.length > 0,
  );
}

function normalizeProvider(raw: RawProvider, connected: Set<string>): CatalogProvider | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  const models: CatalogModel[] = [];
  const rawModels = raw.models ?? {};
  for (const [modelID, m] of Object.entries(rawModels)) {
    if (!m || typeof m !== "object") continue;
    models.push({
      providerID: typeof m.providerID === "string" ? m.providerID : raw.id,
      modelID,
      name: typeof m.name === "string" && m.name.length > 0 ? m.name : modelID,
      status: typeof m.status === "string" ? m.status : "unknown",
      contextWindow:
        m.limit && typeof m.limit === "object" && typeof m.limit.context === "number"
          ? m.limit.context
          : null,
      variants: normalizeVariants(m.variants),
    });
  }
  models.sort((a, b) => a.modelID.localeCompare(b.modelID));
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : raw.id,
    connected: connected.has(raw.id),
    models,
  };
}

function normalizeCatalog(raw: RawListResult): ModelCatalog {
  const connected = new Set(
    Array.isArray(raw.connected)
      ? raw.connected.filter((c): c is string => typeof c === "string")
      : [],
  );
  const defaults: Record<string, string> = {};
  if (raw.default && typeof raw.default === "object") {
    for (const [providerID, modelID] of Object.entries(raw.default)) {
      if (typeof providerID === "string" && typeof modelID === "string" && modelID.length > 0) {
        defaults[providerID] = modelID;
      }
    }
  }
  const providers: CatalogProvider[] = [];
  for (const entry of Array.isArray(raw.all) ? raw.all : []) {
    if (!entry || typeof entry !== "object") continue;
    const normalized = normalizeProvider(entry, connected);
    if (normalized) providers.push(normalized);
  }
  providers.sort((a, b) => a.id.localeCompare(b.id));
  return { providers, defaults, fetchedAt: Date.now() };
}

// ─── Fetch con cache TTL, cooldown de fallo y dedupe concurrente ─────────

export async function fetchModelCatalog(force = false): Promise<ModelCatalog> {
  if (!force && cachedCatalog && Date.now() - cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
    return cachedCatalog;
  }
  // En cooldown (fallo reciente): falla SECO sin tocar el server. El caller
  // (gate del motor) ya trata este error como "gate omitido" y sigue.
  if (!force && Date.now() < cooldownUntil) {
    throw new Error("catálogo en cooldown por un fallo reciente");
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const client = await ensureCatalogClient();
      const response = await client.provider.list();
      if (response.error || !response.data) {
        throw new Error(
          `provider.list falló: ${JSON.stringify(response.error ?? "respuesta vacía")}`,
        );
      }
      cachedCatalog = normalizeCatalog(response.data);
      cooldownUntil = 0;
      return cachedCatalog;
    } catch (err) {
      // Marca el cooldown: los siguientes fetch fallan seco hasta que
      // expire o alguien invalide explícitamente.
      cooldownUntil = Date.now() + CATALOG_FAILURE_COOLDOWN_MS;
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// ─── Validación de una fase contra el catálogo ───────────────────────────

const MAX_ALTERNATIVES = 8;

/**
 * Alternativas sugeridas cuando el modelo configurado no está: primero los
 * defaults de proveedores CONECTADOS, después el resto de sus modelos.
 * Solo conectados — sugerir un proveedor sin auth es mandar a otro error.
 */
export function buildAlternatives(catalog: ModelCatalog): string[] {
  const out: string[] = [];
  const connectedProviders = catalog.providers.filter((p) => p.connected);
  for (const provider of connectedProviders) {
    const def = catalog.defaults[provider.id];
    if (def && provider.models.some((m) => m.modelID === def)) {
      out.push(formatModelRef({ providerID: provider.id, modelID: def }));
    }
  }
  for (const provider of connectedProviders) {
    for (const model of provider.models) {
      if (out.length >= MAX_ALTERNATIVES) return out;
      const ref = formatModelRef(model);
      if (!out.includes(ref)) out.push(ref);
    }
  }
  return out.slice(0, MAX_ALTERNATIVES);
}

export function validatePhaseAgainstCatalog(
  phaseId: PhaseId,
  catalog: ModelCatalog,
  overrides?: Partial<Record<PhaseId, ModelRef>> | null,
): PhaseValidation {
  const effective = resolveModelForPhase(phaseId, overrides);

  // Fase sin pin (CLI con default global de opencode): nada que validar.
  if (effective === null) {
    return { ok: true, phaseId, effective: null };
  }

  const fail = (reason: string): PhaseValidation => ({
    ok: false,
    phaseId,
    effective,
    reason,
    alternatives: buildAlternatives(catalog),
  });

  const provider = catalog.providers.find((p) => p.id === effective.providerID);
  if (!provider) {
    return fail(
      `El proveedor "${effective.providerID}" no está disponible en esta instalación de opencode.`,
    );
  }
  if (!provider.connected) {
    return fail(
      `El proveedor "${effective.providerID}" existe pero no está autenticado (conectalo con: opencode auth login).`,
    );
  }
  const model = provider.models.find((m) => m.modelID === effective.modelID);
  if (!model) {
    return fail(
      `El modelo "${formatModelRef(effective)}" no existe en el proveedor "${effective.providerID}".`,
    );
  }
  if (
    effective.variant !== undefined &&
    model.variants.length > 0 &&
    !model.variants.includes(effective.variant)
  ) {
    return fail(
      `La variant "${effective.variant}" no está soportada por "${formatModelRef(effective)}" (soportadas: ${model.variants.join(", ") || "ninguna"}).`,
    );
  }
  return { ok: true, phaseId, effective };
}

/**
 * Valida TODAS las fases configuradas (para el estado global de Settings):
 * devuelve solo las que fallan, con su motivo.
 */
export function validateAllPhases(
  catalog: ModelCatalog,
  overrides?: Partial<Record<PhaseId, ModelRef>> | null,
): PhaseValidation[] {
  return PHASE_IDS.map((phaseId) =>
    validatePhaseAgainstCatalog(phaseId, catalog, overrides),
  ).filter((v) => !v.ok);
}
