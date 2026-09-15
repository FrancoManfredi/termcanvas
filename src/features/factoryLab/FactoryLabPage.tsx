import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkItemsPolling } from "./hooks/useWorkItemsPolling";
import { WorkItemList } from "./components/WorkItemList";
import { ForemanLogPanel } from "./components/ForemanLogPanel";
import { FlowBar } from "./components/FlowBar";
import { VerificationPanel } from "./components/VerificationPanel";
import { ReviewPanel } from "./components/ReviewPanel";
import { ScorersPanel } from "./components/ScorersPanel";
import { BenchmarksPanel } from "./components/BenchmarksPanel";
import { SelfImprovementPanel } from "./components/SelfImprovementPanel";
import { NotificationsBell } from "./components/NotificationsBell";
import { DefinitionBadge } from "./components/DefinitionBadge";
import { AutomationsPanel } from "./components/AutomationsPanel";
import { IntegrationsPanel } from "./components/IntegrationsPanel";
import {
  fetchDefinitionStatus,
  type DefinitionStatusData,
} from "./components/definitionUi";
import { ModelCombobox } from "@/components/settings/ModelCombobox";
import { buildPhaseModelGroups, type PhaseModelGroup } from "@/components/settings/phaseModelOptions";
import type { CatalogResult, ModelCatalog } from "../../../shared/modelCatalog";
import { useWorkItemStore } from "@/stores/workItemStore";
import { useProjectStore } from "@/stores/projectStore";

// ---------------------------------------------------------------------------
// FactoryLabPage — Reemplazo de 3 selects + tabs por ModelCombobox buscable
// Data source: window.termcanvas.models.listAvailable (400+ modelos reales) con
// fallback a GET 4096/provider sin tabs. Valor canónico "provider/model".
// ---------------------------------------------------------------------------

const FACTORY_RANGE_START = 17680;
const FACTORY_RANGE_END = 17690;
// Ola 6 H1: sin ruta adivinada — el worktree se resuelve en runtime (store + window);
// vacío = sin proyecto activo (la UI lo muestra y deshabilita "Crear sesión").
const FALLBACK_WORKTREE = "";
const FACTORY_PHASE = "diagnosisLlm";
const DEFAULT_PROMPT = "Test Factory tildes ñ → 😀";
const FETCH_TIMEOUT_MS = 3000;
const PROVIDER_TIMEOUT_MS = 5000;

const DEFAULT_MODEL_VALUE = "opencode-go/muse-spark-1.3-contributor";

const REQUIRED_MODELS: Array<{ providerID: string; modelID: string }> = [
  { providerID: "opencode", modelID: "big-pickle" },
  { providerID: "opencode", modelID: "muse-spark-1.2" },
  { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
];

function resolveWindowActiveProjectPath(): string | null {
  try {
    const w = window as unknown as {
      termcanvas?: {
        projectStore?: {
          activeProject?: unknown;
        };
        project?: unknown;
      };
    };
    const active = w?.termcanvas?.projectStore?.activeProject;
    if (typeof active === "string" && active.trim().length > 0) {
      return active.trim();
    }
    if (active && typeof active === "object") {
      const obj = active as Record<string, unknown>;
      const candidates = [obj.path, obj.worktree, obj.directory, obj.worktreePath, obj.repoPath];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim().length > 0) return c.trim();
      }
    }
  } catch {
    // ignore — window puede no existir en tests SSR
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers de red con timeout
// ---------------------------------------------------------------------------

// TODO(F4-vista-única): migrar a src/lib/factoryClient.ts (único importador de red del renderer); carry-over F4-E2: el acceso directo actual NO se toca en esta tanda.
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const externalSignal = init.signal as AbortSignal | undefined;
  if (externalSignal) {
    const onAbort = () => ctrl.abort();
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

let cachedFactoryPort: number | null = null;
let cachedFactoryPortAt = 0;
const FACTORY_CACHE_TTL_MS = 30000;
async function discoverFactoryPort(): Promise<number | null> {
  const now = Date.now();
  if (cachedFactoryPort !== null && now - cachedFactoryPortAt < FACTORY_CACHE_TTL_MS) {
    try {
      const res = await fetchWithTimeout(`http://127.0.0.1:${cachedFactoryPort}/factory/health`, {}, 1200);
      if (res.ok) {
        cachedFactoryPortAt = now;
        return cachedFactoryPort;
      }
    } catch {}
    cachedFactoryPort = null;
  }
  for (let port = FACTORY_RANGE_START; port <= FACTORY_RANGE_END; port++) {
    try {
      const res = await fetchWithTimeout(`http://127.0.0.1:${port}/factory/health`, {}, 800);
      if (res.ok) {
        cachedFactoryPort = port;
        cachedFactoryPortAt = now;
        return port;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function hasValidDashboard(dashboardUrl: string | null | undefined, sessionId: string | null | undefined): boolean {
  if (!dashboardUrl || !sessionId) return false;
  return dashboardUrl.includes("/session/") && dashboardUrl.includes("ses_") && dashboardUrl.includes("127.0.0.1:4096");
}

// ---------------------------------------------------------------------------
// Fallback catalog helpers — usados solo si window.termcanvas.models no existe
// ---------------------------------------------------------------------------

interface RawModelFromAPI {
  id?: unknown;
  providerID?: unknown;
  name?: unknown;
  status?: unknown;
  variants?: unknown;
  limit?: unknown;
}

interface RawProviderFromAPI {
  id?: unknown;
  name?: unknown;
  source?: unknown;
  models?: Record<string, RawModelFromAPI> | null;
}

function normalizeVariants(rawVariants: unknown): string[] {
  if (!rawVariants || typeof rawVariants !== "object") return [];
  if (Array.isArray(rawVariants)) {
    return (rawVariants as unknown[]).filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return Object.keys(rawVariants as Record<string, unknown>).filter((k) => k.length > 0);
}

function sortProviderIds(ids: string[]): string[] {
  const priority = ["opencode-go", "opencode"];
  return [...ids].sort((a, b) => {
    const aPri = priority.indexOf(a);
    const bPri = priority.indexOf(b);
    if (aPri !== -1 && bPri !== -1) return aPri - bPri;
    if (aPri !== -1) return -1;
    if (bPri !== -1) return 1;
    return a.localeCompare(b);
  });
}

function buildCatalogFromRaw(rawProviders: RawProviderFromAPI[]): ModelCatalog {
  const providerMap = new Map<string, { name: string; models: Map<string, { name: string; status: string; variants: string[] }> }>();

  for (const prov of rawProviders) {
    if (!prov || typeof prov !== "object") continue;
    const providerIdFromProv = typeof prov.id === "string" && prov.id.length > 0 ? prov.id : null;
    if (!providerIdFromProv) continue;
    const providerName = typeof prov.name === "string" && prov.name.length > 0 ? prov.name : providerIdFromProv;
    const modelsDict = prov.models ?? {};
    if (!modelsDict || typeof modelsDict !== "object") continue;

    if (!providerMap.has(providerIdFromProv)) {
      providerMap.set(providerIdFromProv, { name: providerName, models: new Map() });
    }
    const entry = providerMap.get(providerIdFromProv)!;

    for (const [key, m] of Object.entries(modelsDict as Record<string, RawModelFromAPI>)) {
      if (!m || typeof m !== "object") continue;
      const status = typeof m.status === "string" ? m.status : undefined;
      if (status !== undefined && status !== "active") continue;

      let providerID: string =
        typeof m.providerID === "string" && m.providerID.length > 0 ? m.providerID : providerIdFromProv;
      let modelID: string;
      const rawId = typeof m.id === "string" && m.id.length > 0 ? m.id : null;

      if (rawId && rawId.includes("/")) {
        const parts = rawId.split("/");
        if (typeof m.providerID !== "string" || m.providerID.length === 0) {
          providerID = parts[0];
        }
        modelID = parts[1] ?? rawId;
      } else if (key.includes("/")) {
        const parts = key.split("/");
        if (typeof m.providerID !== "string" || m.providerID.length === 0) {
          providerID = parts[0];
        }
        modelID = parts[1] ?? key;
      } else {
        modelID = rawId && rawId.length > 0 ? rawId : key;
      }

      if (!providerID || !modelID) continue;
      // Only include models belonging to this provider bucket — if providerID differs from prov id, route to correct bucket
      const targetProvId = providerID;
      let targetEntry = providerMap.get(targetProvId);
      if (!targetEntry) {
        // Derive name from providerID if not seen yet
        providerMap.set(targetProvId, { name: targetProvId, models: new Map() });
        targetEntry = providerMap.get(targetProvId)!;
      }
      if (targetEntry.models.has(modelID)) continue;
      const name = typeof m.name === "string" && m.name.length > 0 ? m.name : modelID;
      const variants = normalizeVariants(m.variants);
      targetEntry.models.set(modelID, { name, status: status ?? "active", variants });
    }
  }

  const sortedIds = sortProviderIds(Array.from(providerMap.keys()));
  const providers = sortedIds.map((id) => {
    const e = providerMap.get(id)!;
    const models = Array.from(e.models.entries())
      .map(([modelID, meta]) => ({
        providerID: id,
        modelID,
        name: meta.name,
        status: meta.status,
        contextWindow: null as number | null,
        variants: meta.variants,
      }))
      .sort((a, b) => a.modelID.localeCompare(b.modelID));
    return {
      id,
      name: e.name,
      connected: true,
      models,
    };
  });
  return {
    providers,
    defaults: {},
    fetchedAt: Date.now(),
    source: "opencode",
  };
}

function buildMinimalCatalog(): ModelCatalog {
  const raw: RawProviderFromAPI[] = [
    {
      id: "opencode-go",
      name: "opencode-go",
      models: {
        "muse-spark-1.3-contributor": { id: "muse-spark-1.3-contributor", providerID: "opencode-go", name: "muse-spark-1.3-contributor", status: "active", variants: {} },
        "glm-5.2": { id: "glm-5.2", providerID: "opencode-go", name: "glm-5.2", status: "active", variants: {} },
      },
    },
    {
      id: "opencode",
      name: "opencode",
      models: {
        "big-pickle": { id: "big-pickle", providerID: "opencode", name: "big-pickle", status: "active", variants: {} },
        "muse-spark-1.2": { id: "muse-spark-1.2", providerID: "opencode", name: "muse-spark-1.2", status: "active", variants: {} },
        "muse-spark-1.2-contributor-free": { id: "muse-spark-1.2-contributor-free", providerID: "opencode", name: "muse-spark-1.2-contributor-free", status: "active", variants: {} },
        "glm-5.2": { id: "glm-5.2", providerID: "opencode", name: "glm-5.2", status: "active", variants: {} },
        "glm-5": { id: "glm-5", providerID: "opencode", name: "glm-5", status: "active", variants: {} },
        "gemini-3-flash": { id: "gemini-3-flash", providerID: "opencode", name: "gemini-3-flash", status: "active", variants: {} },
      },
    },
    {
      id: "github-copilot",
      name: "github-copilot",
      models: {
        "claude-sonnet-4": { id: "claude-sonnet-4", providerID: "github-copilot", name: "claude-sonnet-4", status: "active", variants: {} },
      },
    },
  ];
  return buildCatalogFromRaw(raw);
}

function ensureRequiredModelsInCatalog(catalog: ModelCatalog): ModelCatalog {
  // Clone shallow to avoid mutating cached object
  const providers = catalog.providers.map((p) => ({
    ...p,
    models: [...p.models],
  }));
  const providerById = new Map(providers.map((p) => [p.id, p]));

  for (const req of REQUIRED_MODELS) {
    let prov = providerById.get(req.providerID);
    if (!prov) {
      prov = { id: req.providerID, name: req.providerID, connected: true, models: [] };
      providers.push(prov);
      providerById.set(req.providerID, prov);
    }
    const exists = prov.models.some((m) => m.modelID === req.modelID);
    if (!exists) {
      prov.models.push({
        providerID: req.providerID,
        modelID: req.modelID,
        name: req.modelID,
        status: "active",
        contextWindow: null,
        variants: [],
      });
      prov.models.sort((a, b) => a.modelID.localeCompare(b.modelID));
    }
  }

  // Re-sort providers with priority
  const sortedIds = sortProviderIds(providers.map((p) => p.id));
  const sortedProviders = sortedIds.map((id) => providerById.get(id)!);
  // Append any that were not in priority list but exist (preserving order)
  for (const p of providers) {
    if (!sortedIds.includes(p.id)) sortedProviders.push(p);
  }

  return { ...catalog, providers: sortedProviders, fetchedAt: Date.now() };
}

async function fetchProviderCatalogWithFallback(): Promise<{ catalog: ModelCatalog; error?: string }> {
  // Helper no bloqueante con AbortController y retry 1 si abort/timeout - asegura 62 modelos no solo 9 fallback
  const fetchProviderWithRetry = async (): Promise<{ catalog: ModelCatalog }> => {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout("http://127.0.0.1:4096/provider", {}, PROVIDER_TIMEOUT_MS);
        if (!res.ok) throw new Error(`GET /provider → ${res.status}`);
        const data: unknown = await res.json();
        let providersRaw: RawProviderFromAPI[] = [];
        if (Array.isArray(data)) {
          providersRaw = data as RawProviderFromAPI[];
        } else if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).all)) {
          providersRaw = (data as Record<string, unknown>).all as RawProviderFromAPI[];
        } else if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).providers)) {
          providersRaw = (data as Record<string, unknown>).providers as RawProviderFromAPI[];
        } else {
          throw new Error("formato /provider inesperado");
        }
        const catalog = buildCatalogFromRaw(providersRaw);
        const totalModels = catalog.providers.reduce((acc, p) => acc + p.models.length, 0);
        if (totalModels > 0) return { catalog };
        throw new Error("sin modelos activos en /provider");
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        const isAbort = msg.includes("abort") || msg.includes("timeout");
        if (isAbort && attempt === 0) {
          // retry 1 vez con AbortController fresco (no bloqueante)
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };

  try {
    const result = await fetchProviderWithRetry();
    // Verificación: si catálogo tiene pocos modelos (<10) tratar como fallback mínimo, no 62 reales
    const totalCheck = result.catalog.providers.reduce((acc, p) => acc + p.models.length, 0);
    if (totalCheck >= 10) return result;
    // si tiene pocos, intentar /config antes de minimal
    throw new Error("catalogo con pocos modelos, intentar /config");
  } catch (providerErr) {
    const providerMsg = providerErr instanceof Error ? providerErr.message : String(providerErr);
    const isAbort = providerMsg.toLowerCase().includes("abort") || providerMsg.toLowerCase().includes("timeout");

    // Fallback 1: GET /config con timeout 5000 y retry 1 si abort (no bloqueante)
    try {
      let cfgRes: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          cfgRes = await fetchWithTimeout("http://127.0.0.1:4096/config", {}, PROVIDER_TIMEOUT_MS);
          break;
        } catch (e) {
          const m = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
          const isAbortCfg = m.includes("abort") || m.includes("timeout");
          if (isAbortCfg && attempt === 0) continue;
          throw e;
        }
      }
      if (cfgRes && cfgRes.ok) {
        const cfg: unknown = await cfgRes.json();
        let cfgProvidersRaw: RawProviderFromAPI[] | null = null;
        if (Array.isArray(cfg)) cfgProvidersRaw = cfg as RawProviderFromAPI[];
        else if (cfg && typeof cfg === "object") {
          const obj = cfg as Record<string, unknown>;
          if (Array.isArray(obj.all)) cfgProvidersRaw = obj.all as RawProviderFromAPI[];
          else if (Array.isArray(obj.providers)) cfgProvidersRaw = obj.providers as RawProviderFromAPI[];
        }
        if (cfgProvidersRaw && cfgProvidersRaw.length > 0) {
          const cfgCatalog = buildCatalogFromRaw(cfgProvidersRaw);
          const total = cfgCatalog.providers.reduce((acc, p) => acc + p.models.length, 0);
          if (total > 0) return { catalog: cfgCatalog };
        }
      }
    } catch {
      // ignora y cae a minimal
    }

    const minimal = buildMinimalCatalog();
    const reason = isAbort ? `timeout 5s en /provider` : providerMsg;
    return { catalog: minimal, error: `${reason} — usando lista mínima con credencial disponible` };
  }
}

type FactoryJobCreateResponse = {
  id: string;
  path?: string;
  dashboardUrl?: string;
  sessionId?: string;
  directory?: string;
  job?: {
    id: string;
    prompt: string;
    worktree: string;
    phase: string;
    state: string;
    dashboardUrl?: string;
    sessionId?: string;
    directory?: string;
  };
};

export function FactoryLabPage() {
  // Estado único canónico "provider/model" — variant siempre default
  const [selectedValue, setSelectedValue] = useState<string>(DEFAULT_MODEL_VALUE);
  // Revisor explícito (Ola 4.1) — vacío = automático disjunto elegido por el daemon
  const [reviewerValue, setReviewerValue] = useState<string>("");

  // Modelos para ModelCombobox
  const [groups, setGroups] = useState<PhaseModelGroup[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [promptInput, setPromptInput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<string[] | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [, setJobId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ready'>('idle');
  const [syncBanner, setSyncBanner] = useState<string | null>(null);
  // Ola 5: buildId del daemon (qué código corre) — best-effort, no bloquea.
  const [daemonBuild, setDaemonBuild] = useState<{ buildId: string; startedAt: number | string } | null>(null);
  // Ola 20 E2: estado de definition para el badge (null = desconocido → gris).
  // Cero polling nuevo: se refresca en el MISMO tick de salud del daemon (30s).
  const [definitionStatus, setDefinitionStatus] = useState<DefinitionStatusData | null>(null);

  const canGoToSession = hasValidDashboard(dashboardUrl, sessionId);

  // Track latest selectedValue for reconciliation inside effect without dependency loop
  const selectedValueRef = useRef(selectedValue);
  useEffect(() => {
    selectedValueRef.current = selectedValue;
  }, [selectedValue]);

  // Proyecto activo — worktree real (no hardcoded tmp)
  const projects = useProjectStore((s) => s.projects);
  const focusedProjectId = useProjectStore((s) => s.focusedProjectId);
  const focusedWorktreeId = useProjectStore((s) => s.focusedWorktreeId);

  const activeWorktree = useMemo(() => {
    const winPath = resolveWindowActiveProjectPath();
    if (winPath) return winPath;
    if (projects.length > 0) {
      if (focusedProjectId) {
        const proj = projects.find((p) => p.id === focusedProjectId);
        if (proj) {
          if (focusedWorktreeId) {
            const wt = proj.worktrees.find((w) => w.id === focusedWorktreeId);
            if (wt?.path) return wt.path;
          }
          const primary = proj.worktrees.find((w) => w.isPrimary);
          if (primary?.path) return primary.path;
          if (proj.worktrees[0]?.path) return proj.worktrees[0].path;
          if (proj.path) return proj.path;
        }
      }
      const first = projects[0];
      if (first) {
        const primary = first.worktrees.find((w) => w.isPrimary);
        if (primary?.path) return primary.path;
        if (first.worktrees[0]?.path) return first.worktrees[0].path;
        if (first.path) return first.path;
      }
    }
    return FALLBACK_WORKTREE;
  }, [projects, focusedProjectId, focusedWorktreeId]);

  // Ola 1: polling vivo Work Items + Foreman logs cada 2.5s sin reload
  useWorkItemsPolling(true);
  const { workItems } = useWorkItemStore();

  // Ola 5: buildId del daemon junto a "Proyecto destino" (poll 30s, best-effort).
  useEffect(() => {
    let cancelled = false;
    async function loadDaemonBuild() {
      try {
        const port = await discoverFactoryPort();
        if (port === null || cancelled) return;
        const res = await fetchWithTimeout(`http://127.0.0.1:${port}/factory/health`, {}, 1500);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { buildId?: unknown; startedAt?: unknown };
        if (typeof body.buildId === "string" && body.buildId.length > 0 && !cancelled) {
          setDaemonBuild({ buildId: body.buildId, startedAt: (body.startedAt as number | string) ?? "" });
        }
        // Ola 20 E2: definition enganchada al mismo tick (mismo puerto ya
        // descubierto, timeout propio 5s). Fallo → null = badge gris visible.
        try {
          const def = await fetchDefinitionStatus(
            (url, init) => fetchWithTimeout(url, init ?? {}, 5000),
            port,
          );
          if (!cancelled) setDefinitionStatus(def);
        } catch {
          if (!cancelled) setDefinitionStatus(null);
        }
      } catch {
        // best-effort: sin daemon no se muestra nada
      }
    }
    void loadDaemonBuild();
    const t = window.setInterval(() => {
      void loadDaemonBuild();
    }, 30000);
    return () => window.clearInterval(t);
  }, []);

  // For FlowBar: status del primer workItem o Intake si vacío — Ola 3 con verification
  const flowCurrentStatus = useMemo(() => {
    if (workItems.length > 0) return workItems[0].status;
    return "Intake" as const;
  }, [workItems]);

  const flowVerification = useMemo(() => {
    if (workItems.length === 0) return null;
    const wi = workItems[0];
    const rev = [...(wi.timeline ?? [])].reverse();
    for (const e of rev) {
      const m = e.meta as Record<string, unknown> | undefined;
      if (m && typeof m.verification === "object" && m.verification !== null) {
        return m.verification as unknown as import("../../../shared/types/implement").VerificationReport;
      }
    }
    return null;
  }, [workItems]);

  const selectedVerificationId = useMemo(() => {
    if (workItems.length > 0) return workItems[0].id;
    return null;
  }, [workItems]);

  // Ola 4: veredicto + contador del primer WorkItem para el badge del FlowBar
  const flowReview = useMemo(() => {
    if (workItems.length === 0) return { verdict: null, count: null } as const;
    const wi = workItems[0] as unknown as {
      reviewCount?: number;
      lastReview?: { verdict?: string };
    };
    const v = wi.lastReview?.verdict;
    const verdict = v === "accept" || v === "revise" || v === "ask_human" ? v : null;
    return {
      verdict,
      count: typeof wi.reviewCount === "number" ? wi.reviewCount : null,
    } as const;
  }, [workItems]);

  // Reset sync banner when session changes
  useEffect(() => {
    if (sessionId) {
      setSyncStatus('idle');
      setSyncBanner(null);
    }
  }, [sessionId]);

  // Carga de modelos: window.termcanvas.models.listAvailable primero, fallback a fetch 4096/provider
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoadingModels(true);
      setModelsError(null);

      let catalog: ModelCatalog | null = null;
      let errorMsg: string | null = null;

      // Intento 1: window.termcanvas.models.listAvailable (catálogo real 400+ modelos)
      const api = (window as unknown as {
        termcanvas?: {
          models?: {
            listAvailable?: (force?: boolean, cli?: string) => Promise<CatalogResult<ModelCatalog> | ModelCatalog>;
            invalidate?: () => Promise<unknown>;
          };
        };
      })?.termcanvas?.models;

      if (api?.listAvailable) {
        try {
          const res = await api.listAvailable(true, "opencode");
          if (res && typeof res === "object" && "ok" in (res as Record<string, unknown>)) {
            const typed = res as CatalogResult<ModelCatalog>;
            if (typed.ok) {
              catalog = typed.data;
            } else {
              errorMsg = typed.error;
            }
          } else if (res && typeof res === "object" && "providers" in (res as Record<string, unknown>)) {
            // Mock harness que devuelve directamente ModelCatalog
            catalog = res as ModelCatalog;
          } else {
            errorMsg = "respuesta inesperada de window.termcanvas.models.listAvailable";
          }
        } catch (e) {
          errorMsg = e instanceof Error ? e.message : String(e);
        }
      }

      // Intento 2: fallback fetch 4096/provider si no hay catálogo
      if (!catalog) {
        try {
          const fallback = await fetchProviderCatalogWithFallback();
          catalog = fallback.catalog;
          if (fallback.error) {
            errorMsg = errorMsg ? `${errorMsg}; ${fallback.error}` : fallback.error;
          }
        } catch (e) {
          catalog = buildMinimalCatalog();
          errorMsg = e instanceof Error ? e.message : String(e);
        }
      }

      if (!catalog) {
        catalog = buildMinimalCatalog();
      }

      // Asegurar que big-pickle y los otros requeridos existan
      catalog = ensureRequiredModelsInCatalog(catalog);

      // Construir grupos para ModelCombobox
      let nextGroups = buildPhaseModelGroups(catalog);

      // Paranoia: si buildPhaseModelGroups filtró algo o catálogo estaba vacío, forzar big-pickle en groups
      const flatValues = nextGroups.flatMap((g) => g.options.map((o) => o.value));
      const hasBigPickle = flatValues.includes("opencode/big-pickle");
      if (!hasBigPickle) {
        let opencodeGroup = nextGroups.find((g) => g.providerId === "opencode");
        if (!opencodeGroup) {
          opencodeGroup = { providerId: "opencode", label: "opencode", connected: true, options: [] };
          nextGroups = [opencodeGroup, ...nextGroups];
        }
        opencodeGroup.options.push({ value: "opencode/big-pickle", label: "big-pickle", status: "active" });
        opencodeGroup.options.sort((a, b) => a.label.localeCompare(b.label));
      }

      // Asegurar también los otros dos requeridos estén en groups (por si catalog tenía provider desconectado y buildPhase no los mapeó)
      for (const req of REQUIRED_MODELS) {
        const val = `${req.providerID}/${req.modelID}`;
        const exists = nextGroups.some((g) => g.options.some((o) => o.value === val));
        if (!exists) {
          let g = nextGroups.find((grp) => grp.providerId === req.providerID);
          if (!g) {
            g = { providerId: req.providerID, label: req.providerID, connected: true, options: [] };
            nextGroups.push(g);
          }
          g.options.push({ value: val, label: req.modelID, status: "active" });
          g.options.sort((a, b) => a.label.localeCompare(b.label));
        }
      }

      if (cancelled) return;

      setGroups(nextGroups);
      if (errorMsg) setModelsError(errorMsg);
      else setModelsError(null);

      // Reconcilia selección: si el valor actual no está en el catálogo, cae a default preferido
      const allValues = nextGroups.flatMap((g) => g.options.map((o) => o.value));
      setSelectedValue((prev) => {
        const current = prev || selectedValueRef.current;
        if (allValues.includes(current)) return current;
        if (allValues.includes(DEFAULT_MODEL_VALUE)) return DEFAULT_MODEL_VALUE;
        if (allValues.includes("opencode/big-pickle")) return "opencode/big-pickle";
        if (allValues.includes("opencode/muse-spark-1.2")) return "opencode/muse-spark-1.2";
        const firstConnected = nextGroups.find((g) => g.connected)?.options[0]?.value;
        if (firstConnected) return firstConnected;
        return allValues[0] ?? DEFAULT_MODEL_VALUE;
      });

      setIsLoadingModels(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = useCallback(async () => {
    setError(null);
    setAlternatives(null);
    if (!activeWorktree) {
      setError("Sin proyecto activo — abrí un proyecto para crear sesiones.");
      return;
    }
    setLoading(true);

    let port: number | null = null;
    try {
      port = await discoverFactoryPort();
      if (port === null) {
        setError(`Factory no disponible en ${FACTORY_RANGE_START}-${FACTORY_RANGE_END}.`);
        setLoading(false);
        return;
      }

      const effectivePrompt = promptInput.trim() ? promptInput.trim() : DEFAULT_PROMPT;

      const effectiveValue = (selectedValue && selectedValue.trim()) ? selectedValue.trim() : DEFAULT_MODEL_VALUE;
      // Parse canónico "provider/model" — modelID puede contener "/" así que cortar solo en el primer slash
      const slashIdx = effectiveValue.indexOf("/");
      let providerID: string;
      let modelID: string;
      if (slashIdx > 0 && slashIdx < effectiveValue.length - 1) {
        providerID = effectiveValue.slice(0, slashIdx);
        modelID = effectiveValue.slice(slashIdx + 1);
      } else {
        // fallback defensivo: si no hay slash, usa default
        providerID = "opencode-go";
        modelID = "muse-spark-1.3-contributor";
      }

      const body: Record<string, unknown> = {
        prompt: effectivePrompt,
        worktree: activeWorktree,
        phase: FACTORY_PHASE,
        modelRef: {
          providerID,
          modelID,
          variant: "default",
        },
      };

      // Revisor explícito (Ola 4.1) — solo si el usuario eligió uno; vacío = automático en daemon
      const reviewerTrimmed = (reviewerValue && reviewerValue.trim()) ? reviewerValue.trim() : "";
      const reviewerSlashIdx = reviewerTrimmed.indexOf("/");
      if (reviewerSlashIdx > 0 && reviewerSlashIdx < reviewerTrimmed.length - 1) {
        body.reviewerRef = {
          providerID: reviewerTrimmed.slice(0, reviewerSlashIdx),
          modelID: reviewerTrimmed.slice(reviewerSlashIdx + 1),
          variant: "default",
        };
      }

      let res: Response;
      try {
        res = await fetchWithTimeout(`http://127.0.0.1:${port}/factory/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes("abort")) {
          throw new Error(`Timeout 3s al conectar con Factory en puerto ${port}`);
        }
        throw new Error(msg);
      }

      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // no json
      }

      if (!res.ok) {
        let alt: string[] | null = null;
        let errMsg = `POST /factory/jobs → ${res.status} ${text.slice(0, 600)}`;
        if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          if (Array.isArray(obj.alternatives)) {
            alt = (obj.alternatives as unknown[]).map(String);
          }
          if (typeof obj.error === "string") {
            errMsg = obj.error;
            if (alt && alt.length) errMsg += ` — alternatives: ${alt.join(", ")}`;
            else if (typeof obj.hint === "string") errMsg += ` — hint: ${obj.hint}`;
          } else if (typeof obj.hint === "string") {
            errMsg += ` — hint: ${obj.hint}`;
          }
        }
        setAlternatives(alt);
        throw new Error(errMsg);
      }

      const parsed = data as FactoryJobCreateResponse;
      if (!parsed || typeof parsed.id !== "string") {
        throw new Error(`Respuesta inesperada del Factory: ${text.slice(0, 600)}`);
      }

      const initialDashboardUrl =
        (typeof parsed.dashboardUrl === "string" && parsed.dashboardUrl.trim() ? parsed.dashboardUrl.trim() : undefined) ??
        (parsed.job && typeof parsed.job.dashboardUrl === "string" && parsed.job.dashboardUrl.trim() ? parsed.job.dashboardUrl.trim() : undefined) ??
        null;

      const initialSessionId =
        (typeof parsed.sessionId === "string" && parsed.sessionId.trim() ? parsed.sessionId.trim() : undefined) ??
        (parsed.job && typeof parsed.job.sessionId === "string" && parsed.job.sessionId.trim() ? parsed.job.sessionId.trim() : undefined) ??
        null;

      setJobId(parsed.id);
      if (initialDashboardUrl) setDashboardUrl(initialDashboardUrl);
      else setDashboardUrl(null);
      if (initialSessionId) setSessionId(initialSessionId);
      else setSessionId(null);

      const alreadyValid = hasValidDashboard(initialDashboardUrl ?? null, initialSessionId ?? null);
      if (!alreadyValid) {
        const maxAttempts = 5;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const pollRes = await fetchWithTimeout(
              `http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(parsed.id)}`,
              {},
              FETCH_TIMEOUT_MS,
            );
            if (!pollRes.ok) continue;
            const pollText = await pollRes.text();
            let pollData: unknown = null;
            try {
              pollData = pollText ? JSON.parse(pollText) : null;
            } catch {
              continue;
            }
            if (!pollData || typeof pollData !== "object") continue;
            const obj = pollData as Record<string, unknown>;
            const polledDashboard =
              (typeof obj.dashboardUrl === "string" && obj.dashboardUrl.trim() ? obj.dashboardUrl.trim() : undefined) ??
              (obj.resultPreview && typeof (obj.resultPreview as Record<string, unknown>).dashboardUrl === "string"
                ? String((obj.resultPreview as Record<string, unknown>).dashboardUrl).trim()
                : undefined) ??
              null;
            const polledSession =
              (typeof obj.sessionId === "string" && obj.sessionId.trim() ? obj.sessionId.trim() : undefined) ??
              (obj.resultPreview && typeof (obj.resultPreview as Record<string, unknown>).sessionId === "string"
                ? String((obj.resultPreview as Record<string, unknown>).sessionId).trim()
                : undefined) ??
              null;

            if (polledDashboard) setDashboardUrl(polledDashboard);
            if (polledSession) setSessionId(polledSession);

            if (hasValidDashboard(polledDashboard, polledSession)) {
              break;
            }
          } catch {
            // polling error ignored, retry
          }
        }
      }

      setLoading(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout")) {
        setError(`Timeout 3s: ${msg}`);
      } else {
        setError(msg);
      }
      setLoading(false);
    }
  }, [selectedValue, reviewerValue, promptInput, activeWorktree]);

  const handleGoToSession = useCallback(() => {
    if (!dashboardUrl || !sessionId) return;
    let opened: Window | null = null;
    try {
      opened = window.open(dashboardUrl, "_blank");
    } catch {}
    setSyncStatus('syncing');
    setSyncBanner('Sincronizando...');
    let attempts = 0;
    const maxAttempts = 20; // 30s / 1.5s
    const pollInterval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetchWithTimeout(`http://127.0.0.1:4096/session/${encodeURIComponent(sessionId)}/message`, {}, FETCH_TIMEOUT_MS);
        if (res.ok) {
          const data: unknown = await res.json().catch(() => null);
          if (Array.isArray(data)) {
            const hasAssistantStop = (data as Record<string, unknown>[]).some((m) => {
              const rec = m as Record<string, unknown>;
              const info = (rec.info as Record<string, unknown> | undefined) ?? rec;
              const role = (info?.role as string | undefined) ?? (rec.role as string | undefined);
              if (role !== 'assistant') return false;
              const finish =
                (info?.finish as string | undefined) ??
                (rec.finish as string | undefined) ??
                (info?.stopReason as string | undefined) ??
                (rec.stopReason as string | undefined) ??
                (info?.finishReason as string | undefined) ??
                (rec.finishReason as string | undefined);
              if (finish === 'stop') return true;
              return false;
            });
            if (hasAssistantStop) {
              clearInterval(pollInterval);
              setSyncStatus('ready');
              setSyncBanner('✓ Respuesta lista');
              try {
                if (opened && !opened.closed) {
                  try {
                    opened.location.reload();
                  } catch {
                    window.open(dashboardUrl, '_blank');
                  }
                } else {
                  window.open(dashboardUrl, '_blank');
                }
              } catch {}
              setTimeout(() => setSyncBanner(null), 4000);
              return;
            }
          }
        }
      } catch {}
      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        setSyncStatus('idle');
        setSyncBanner(null);
      }
    }, 1500);
    setTimeout(() => clearInterval(pollInterval), 30000);
  }, [dashboardUrl, sessionId]);

  return (
    <div className="flex h-full flex-col overflow-auto bg-white p-6">
      <div className="mx-auto w-[90%] max-w-[1400px]">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-zinc-900">Factory Lab</h1>
          <NotificationsBell />
        </div>
        <p className="mb-4 mt-1 text-xs text-zinc-500">
          Creá un job con un modelo, seguí el flujo en vivo y revisá el veredicto antes de completar.
        </p>

        {isLoadingModels ? (
          <div className="mb-3" aria-busy="true" aria-label="Cargando modelos">
            <div className="h-9 animate-pulse rounded-md bg-zinc-100" />
          </div>
        ) : null}

        {modelsError && !isLoadingModels ? (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800" aria-live="polite">
            Aviso: {modelsError} — usando lista mínima.
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[min(280px,100%)] flex-1 flex-col gap-1 text-xs text-zinc-700">
            <span>Modelo</span>
            {isLoadingModels ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">Cargando modelos...</div>
            ) : (
              <ModelCombobox
                value={selectedValue}
                groups={groups}
                onChange={setSelectedValue}
                defaultLabel="Seleccionar modelo"
              />
            )}
          </label>

          <label className="flex min-w-[min(280px,100%)] flex-1 flex-col gap-1 text-xs text-zinc-700">
            <span>Modelo revisor (opcional)</span>
            {isLoadingModels ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">Cargando modelos...</div>
            ) : (
              <ModelCombobox
                value={reviewerValue}
                groups={groups}
                onChange={setReviewerValue}
                defaultLabel="Automático (distinto al builder)"
              />
            )}
          </label>

          <label className="flex min-w-[min(220px,100%)] flex-1 flex-col gap-1 text-xs text-zinc-700">
            <span>Prompt (opcional)</span>
            <input
              aria-label="Prompt"
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder={DEFAULT_PROMPT}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={loading || isLoadingModels || !activeWorktree}
            title={!activeWorktree ? "Sin proyecto activo — abrí un proyecto para crear sesiones." : undefined}
            className="inline-flex h-[38px] items-center justify-center rounded-md bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            {loading ? "Creando…" : "Crear sesión"}
          </button>
        </div>

        {/* Proyecto destino — el job y sus archivos se crean acá */}
        <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-600" aria-live="polite">
          <span className="shrink-0 font-semibold">Proyecto destino:</span>
          <span className="truncate font-mono text-zinc-700" title={activeWorktree || "sin proyecto activo"}>
            {activeWorktree || "sin proyecto activo"}
          </span>
          {daemonBuild ? (
            <span className="shrink-0 font-mono text-zinc-500" title={String(daemonBuild.startedAt)}>
              daemon {daemonBuild.buildId}
            </span>
          ) : null}
          {/* Ola 20 E2: badge de definition junto al buildId (gris si se desconoce) */}
          <DefinitionBadge data={definitionStatus} />
        </div>
        {!activeWorktree ? (
          <div className="mt-1 text-[11px] text-amber-700" aria-live="polite">
            Sin proyecto activo — abrí un proyecto para crear sesiones.
          </div>
        ) : null}

        <div className="mt-2 text-[11px] text-zinc-500" aria-live="polite">
          Modelo: <span className="font-mono font-medium text-zinc-700">{selectedValue}</span>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500" aria-live="polite">
          Revisor:{" "}
          <span className="font-mono font-medium text-zinc-700">
            {reviewerValue.trim() ? reviewerValue.trim() : "Automático (distinto al builder)"}
          </span>
        </div>
        {reviewerValue.trim() &&
        selectedValue.trim() &&
        reviewerValue.trim().toLowerCase() === selectedValue.trim().toLowerCase() ? (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800" aria-live="polite">
            Mismo modelo que el builder: el daemon lo va a bloquear (anti auto-aprobación) y el job quedará en
            espera. Elegí otro revisor o dejá Automático.
          </div>
        ) : null}

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-snug text-red-800">
            <div className="font-semibold">Error</div>
            <div className="mt-1 break-words whitespace-pre-wrap">{error}</div>
            {alternatives && alternatives.length > 0 && (
              <div className="mt-2 text-[11px]">
                <span className="font-semibold">Alternatives: </span>
                {alternatives.join(", ")}
              </div>
            )}
          </div>
        )}

        {canGoToSession && dashboardUrl && (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleGoToSession}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              IR A LA SESIÓN
            </button>
            {syncBanner && (
              <div
                className={`mt-3 inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium ${
                  syncStatus === 'ready'
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : 'border-blue-200 bg-blue-50 text-blue-800'
                }`}
                aria-live="polite"
              >
                {syncStatus === 'syncing' ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" aria-hidden="true" />
                    {syncBanner}
                  </span>
                ) : (
                  syncBanner
                )}
              </div>
            )}
          </div>
        )}

        {/* Ola 2 P0-3: FlowBar horizontal — Ola3 con pulse Building + badges pass/fail, Ola4 con badge verdict */}
        <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <h2 className="mb-2 text-xs font-semibold text-zinc-800">Flujo</h2>
          <FlowBar currentStatus={flowCurrentStatus as unknown as import("../../../shared/types/workItem").WorkItemStatus} verification={flowVerification} reviewVerdict={flowReview.verdict} reviewCount={flowReview.count} />
        </div>

        {/* Ola 1: Work Items + Foreman Log sin reload (polling vivo 2.5s) */}
        <WorkItemList />
        {/* Ola 3: VerificationPanel + polling lazy result.json/build.log */}
        <div className="mt-6">
          <VerificationPanel workItemId={selectedVerificationId} />
        </div>
        {/* Ola 4: ReviewPanel + polling GET /:id/review 2.5s */}
        <div className="mt-6">
          <ReviewPanel workItemId={selectedVerificationId} />
        </div>
        {/* Ola 11: ScorersPanel + polling defs 30s / scores del job 5s */}
        <div className="mt-6">
          <ScorersPanel workItemId={selectedVerificationId} />
        </div>
        {/* Ola 12: BenchmarksPanel + polling lista 15s / detalle 5s solo si running */}
        <div className="mt-6">
          <BenchmarksPanel />
        </div>
        {/* Ola 13: SelfImprovementPanel + polling lista 15s / detalle 5s solo si pending */}
        <div className="mt-6">
          <SelfImprovementPanel />
        </div>
        {/* Wave 14: Automations + Integrations (presentational cards, zero new polling) */}
        <div className="mt-6">
          <AutomationsPanel />
        </div>
        <div className="mt-6">
          <IntegrationsPanel />
        </div>
        <ForemanLogPanel />
      </div>
    </div>
  );
}

export default FactoryLabPage;
