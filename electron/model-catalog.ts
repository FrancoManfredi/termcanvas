// Catálogo de modelos por CLI — fuente de verdad para el routing de modelos
// por fase (shared/phaseModels.ts) y para la UI de Settings.
// Multi-CLI desde Fase A: opencode (provider.list) + codebuddy (models.json / CLI).
// PATRÓN EXTENSIBLE: agregar un nuevo CLI consta de 3 pasos aislados:
//   1. Añadir el id a PHASE_CLIS en shared/phaseModels.ts (fuente única).
//   2. Si el CLI tiene catálogo real, registrar su fetcher en CLI_FETCHERS (abajo).
//      Sin fetcher, se usa el stub genérico (binary check + catálogo vacío conectado).
//   3. Si el CLI tiene formato de flag distinto, agregar entrada en src/planner/modelPin.ts
//      (formatModelForCli) y en src/planner/planningSession.ts (headless args).
// Este archivo NO importa "electron": es lógica pura testeable en node.
// La registración IPC vive en model-catalog-ipc.ts.

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
import { encontrarPuertoServidor } from "../headless-runtime/interview/puerto-libre.ts";

// ─── Tipos públicos (canónicos en shared, re-exportados por compat) ──────

import type {
  CatalogModel,
  CatalogProvider,
  CatalogResult,
  ModelCatalog,
  PhaseValidation,
  CliCatalogSource,
} from "../shared/modelCatalog";
export type {
  CatalogModel,
  CatalogProvider,
  CatalogResult,
  ModelCatalog,
  PhaseValidation,
  CliCatalogSource,
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

// ─── Server efímero propio + cache por CLI ───────────────────────────────

const CATALOG_SERVER_TIMEOUT_MS = 30_000;
const CATALOG_SERVER_RETRIES = 2;
const CATALOG_TTL_MS = 5 * 60 * 1000;
const CATALOG_FAILURE_COOLDOWN_MS = 60_000;

type PerCliState = {
  runningServer: { url: string; close: () => void } | null;
  runningClient: CatalogClient | null;
  cachedCatalog: ModelCatalog | null;
  inFlight: Promise<ModelCatalog> | null;
  cooldownUntil: number;
};

const perCliState = new Map<CliCatalogSource, PerCliState>();

function getCliState(cli: CliCatalogSource): PerCliState {
  let s = perCliState.get(cli);
  if (!s) {
    s = {
      runningServer: null,
      runningClient: null,
      cachedCatalog: null,
      inFlight: null,
      cooldownUntil: 0,
    };
    perCliState.set(cli, s);
  }
  return s;
}

// Legacy singletons for backward compat (opencode default)
let _legacyRunningServer: { url: string; close: () => void } | null = null;
let _legacyRunningClient: CatalogClient | null = null;

function syncLegacyState(cli: CliCatalogSource): void {
  const s = getCliState(cli);
  if (cli === "opencode") {
    _legacyRunningServer = s.runningServer;
    _legacyRunningClient = s.runningClient;
  }
}

/**
 * Seam de tests: inyecta un cliente falso y descarta cualquier server real.
 * Espejo de setTestClient del motor de entrevista.
 * Si cli es null, inyecta para opencode (compat).
 */
export function setCatalogClient(client: CatalogClient | null, cli: CliCatalogSource = "opencode"): void {
  const s = getCliState(cli);
  if (s.runningServer) {
    s.runningServer.close();
    s.runningServer = null;
  }
  s.runningClient = client;
  s.cachedCatalog = null;
  s.cooldownUntil = 0;
  s.inFlight = null;
  syncLegacyState(cli);
  if (cli === "opencode") {
    _legacyRunningServer = null;
    _legacyRunningClient = client;
  }
}

async function ensureCatalogClient(cli: CliCatalogSource = "opencode"): Promise<CatalogClient> {
  const s = getCliState(cli);
  if (s.runningClient) return s.runningClient;
  // Only opencode has a server; otros CLI usan fetchers directos
  if (cli !== "opencode") {
    throw new Error(`No catalog client for CLI "${cli}" — use fetcher for ${cli}`);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < CATALOG_SERVER_RETRIES; attempt++) {
    try {
      const server = await createOpencodeServer({
        hostname: "127.0.0.1",
        port: await encontrarPuertoServidor(20000, 45000),
        timeout: CATALOG_SERVER_TIMEOUT_MS,
      });
      s.runningServer = server;
      s.runningClient = createOpencodeClient({ baseUrl: server.url }) as CatalogClient;
      syncLegacyState(cli);
      return s.runningClient;
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

export function closeCatalogServer(cli?: CliCatalogSource): void {
  if (cli) {
    const s = getCliState(cli);
    if (s.runningServer) {
      s.runningServer.close();
      s.runningServer = null;
    }
    s.runningClient = null;
    s.cachedCatalog = null;
    s.cooldownUntil = 0;
    s.inFlight = null;
    syncLegacyState(cli);
    return;
  }
  // Close all
  for (const [c, s] of perCliState.entries()) {
    if (s.runningServer) s.runningServer.close();
    s.runningServer = null;
    s.runningClient = null;
    s.cachedCatalog = null;
    s.cooldownUntil = 0;
    s.inFlight = null;
  }
  _legacyRunningServer = null;
  _legacyRunningClient = null;
}

export function invalidateModelCatalog(cli?: CliCatalogSource): void {
  if (cli) {
    const s = getCliState(cli);
    s.cachedCatalog = null;
    s.cooldownUntil = 0;
    return;
  }
  for (const s of perCliState.values()) {
    s.cachedCatalog = null;
    s.cooldownUntil = 0;
  }
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

function normalizeCatalog(raw: RawListResult, source: CliCatalogSource = "opencode"): ModelCatalog {
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
  return { providers, defaults, fetchedAt: Date.now(), source };
}

// ─── CLI availability — genérico ──────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Verifica si un binario CLI está disponible en PATH.
 * Usa `execSync` con shell + timeout corto. En Electron el PATH puede ser
 * distinto al de la shell del usuario, por eso también probamos `where`/`which`.
 */
// Override para tests: si está seteado, isCliAvailable responde determinista sin tocar el FS/shell.
const cliAvailabilityOverride = new Map<CliCatalogSource, boolean>();

export function isCliAvailable(cli: CliCatalogSource): boolean {
  if (cliAvailabilityOverride.has(cli)) return cliAvailabilityOverride.get(cli)!;
  try {
    execSync(`${cli} --version`, { encoding: "utf-8", timeout: 3000, windowsHide: true, stdio: "ignore" });
    return true;
  } catch {
    // Fallback: where (Windows) / which (unix)
    try {
      const probe = process.platform === "win32" ? `where ${cli}` : `which ${cli}`;
      execSync(probe, { encoding: "utf-8", timeout: 2000, windowsHide: true, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

/** Test seam: fuerza el resultado de isCliAvailable para un CLI sin spawnear procesos. */
export function __setCliAvailableOverride(cli: CliCatalogSource, value: boolean | null): void {
  if (value === null) cliAvailabilityOverride.delete(cli);
  else cliAvailabilityOverride.set(cli, value);
}

/** Test seam: inyecta un catálogo mock ya normalizado para un CLI (bypass del fetcher real). */
export function __injectMockCatalog(cli: CliCatalogSource, catalog: ModelCatalog): void {
  const s = getCliState(cli);
  s.cachedCatalog = catalog;
  s.cooldownUntil = 0;
  s.inFlight = null;
}

/** Test seam: limpia overrides e inyecciones (llamar en beforeEach). */
export function __resetCatalogTestState(): void {
  cliAvailabilityOverride.clear();
  for (const s of perCliState.values()) {
    if (s.runningServer) {
      try { s.runningServer.close(); } catch {}
      s.runningServer = null;
    }
    s.runningClient = null;
    s.cachedCatalog = null;
    s.cooldownUntil = 0;
    s.inFlight = null;
  }
  _legacyRunningServer = null;
  _legacyRunningClient = null;
}

function isCodebuddyAvailable(): boolean {
  return isCliAvailable("codebuddy");
}

// ─── CodeBuddy fetcher (file + binary check) ─────────────────────────────

function readCodebuddyModelsJson(): { models: CatalogModel[]; defaults: Record<string, string> } | null {
  const candidates = [
    path.join(os.homedir(), ".codebuddy", "models.json"),
    path.join(process.cwd(), ".codebuddy", "models.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (Array.isArray(raw.models)) {
        const byVendor = new Map<string, CatalogModel[]>();
        for (const m of raw.models) {
          if (!m || typeof m.id !== "string") continue;
          const vendor = typeof m.vendor === "string" && m.vendor.length > 0 ? m.vendor : "codebuddy";
          const list = byVendor.get(vendor) ?? [];
          list.push({
            providerID: vendor,
            modelID: m.id,
            name: typeof m.name === "string" ? m.name : m.id,
            status: "unknown",
            contextWindow: typeof m.maxInputTokens === "number" ? m.maxInputTokens : null,
            variants: [],
          });
          byVendor.set(vendor, list);
        }
        const models: CatalogModel[] = [];
        for (const list of byVendor.values()) models.push(...list);
        return { models, defaults: {} };
      }
    } catch {}
  }
  return null;
}

function buildCodebuddyBuiltinCatalog(): ModelCatalog {
  const available = isCodebuddyAvailable();
  const builtinModels: Array<{ providerID: string; modelID: string }> = [
    { providerID: "codebuddy", modelID: "default-model" },
    { providerID: "codebuddy", modelID: "fast-model" },
    { providerID: "codebuddy", modelID: "balanced-model" },
    { providerID: "codebuddy", modelID: "primary-model" },
    { providerID: "codebuddy", modelID: "deep-model" },
    { providerID: "codebuddy", modelID: "gpt-5.6-sol" },
    { providerID: "codebuddy", modelID: "gpt-5.6-terra" },
    { providerID: "codebuddy", modelID: "gpt-5.6-luna" },
    { providerID: "codebuddy", modelID: "gpt-5.5" },
    { providerID: "codebuddy", modelID: "gpt-5.4" },
    { providerID: "codebuddy", modelID: "gpt-5.3-codex" },
    { providerID: "codebuddy", modelID: "gemini-3.5-flash" },
    { providerID: "codebuddy", modelID: "glm-5.3" },
    { providerID: "codebuddy", modelID: "glm-5.2" },
    { providerID: "codebuddy", modelID: "kimi-k3" },
    { providerID: "codebuddy", modelID: "kimi-k2.6" },
    { providerID: "codebuddy", modelID: "minimax-m3" },
  ];
  const fromFile = readCodebuddyModelsJson();
  const extraModels = fromFile?.models ?? [];

  const allModels = [...builtinModels.map((m) => ({ ...m, name: m.modelID, status: "unknown", contextWindow: null as number | null, variants: [] as string[] })), ...extraModels];

  const provider: CatalogProvider = {
    id: "codebuddy",
    name: "CodeBuddy",
    connected: available,
    models: allModels.sort((a, b) => a.modelID.localeCompare(b.modelID)),
  };

  const providers: CatalogProvider[] = [provider];

  return {
    providers,
    defaults: fromFile?.defaults ?? { codebuddy: "default-model" },
    fetchedAt: Date.now(),
    source: "codebuddy",
  };
}

// ─── Generic stub para CLIs futuros (claude, codex, gemini, kimi, wuu) ───

function buildGenericStubCatalog(cli: CliCatalogSource): ModelCatalog {
  const available = isCliAvailable(cli);
  // Para CLIs sin fetcher dedicado, devolvemos un catálogo stub con un provider
  // cuyo id coincide con el CLI. Si el binario está instalado, connected=true
  // pero sin modelos conocidos (la validación fallará por modelo inexistente,
  // no por proveedor inexistente — mensaje más accionable).
  // Futuro: cada CLI puede registrar un fetcher real que reemplace este stub.
  const provider: CatalogProvider = {
    id: cli,
    name: cli,
    connected: available,
    models: [],
  };
  return {
    providers: [provider],
    defaults: {},
    fetchedAt: Date.now(),
    source: cli,
  };
}

// ─── Fetchers por CLI — REGISTRY extensible ───────────────────────────────
// Para añadir un CLI nuevo con catálogo real:
//  1. Implementar `async function fetchMyCliCatalog(): Promise<ModelCatalog>`
//  2. Registrarlo acá: [ "mycli" ]: fetchMyCliCatalog
// Sin registro, se usa el stub genérico de arriba (no rompe).

async function fetchCodebuddyRaw(): Promise<ModelCatalog> {
  return buildCodebuddyBuiltinCatalog();
}

async function fetchOpencodeRaw(): Promise<ModelCatalog> {
  const client = await ensureCatalogClient("opencode");
  const response = await client.provider.list();
  if (response.error || !response.data) {
    throw new Error(
      `provider.list falló: ${JSON.stringify(response.error ?? "respuesta vacía")}`,
    );
  }
  return normalizeCatalog(response.data, "opencode");
}

const CLI_FETCHERS: Partial<Record<CliCatalogSource, () => Promise<ModelCatalog>>> = {
  opencode: fetchOpencodeRaw,
  codebuddy: fetchCodebuddyRaw,
  // futuros CLIs con catálogo real se registran aquí
};

async function fetchRawCatalog(cli: CliCatalogSource): Promise<ModelCatalog> {
  const fetcher = CLI_FETCHERS[cli];
  if (fetcher) return fetcher();
  // Sin fetcher dedicado: stub genérico (no lanza, siempre devuelve catálogo)
  return buildGenericStubCatalog(cli);
}

// ─── Fetch con cache TTL, cooldown de fallo y dedupe concurrente ─────────

export async function fetchModelCatalog(force = false, cli: CliCatalogSource = "opencode"): Promise<ModelCatalog> {
  const s = getCliState(cli);
  if (!force && s.cachedCatalog && Date.now() - s.cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
    return s.cachedCatalog;
  }
  if (!force && Date.now() < s.cooldownUntil) {
    const label = cli === "opencode" ? "catálogo" : `catálogo ${cli}`;
    throw new Error(`${label} en cooldown por un fallo reciente`);
  }
  if (s.inFlight) return s.inFlight;

  s.inFlight = (async () => {
    try {
      const catalog = await fetchRawCatalog(cli);
      s.cachedCatalog = catalog;
      s.cooldownUntil = 0;
      return catalog;
    } catch (err) {
      s.cooldownUntil = Date.now() + CATALOG_FAILURE_COOLDOWN_MS;
      throw err;
    } finally {
      s.inFlight = null;
    }
  })();
  return s.inFlight;
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
      `El proveedor "${effective.providerID}" no está disponible en esta instalación de ${catalog.source}.`,
    );
  }
  if (!provider.connected) {
    const hint = catalog.source === "codebuddy" ? "verificá que codebuddy esté instalado y autenticado" : "conectalo con: opencode auth login";
    return fail(
      `El proveedor "${effective.providerID}" existe pero no está autenticado (${hint}).`,
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
