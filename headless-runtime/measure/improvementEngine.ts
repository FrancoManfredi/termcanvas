/**
 * ImprovementEngine — Ola 13 Self-improvement.
 * Propuestas versionadas que un humano adopta o descarta. JAMÁS escribe en
 * `factory/skills|agents` sin click humano (único writer: `adoptProposal`,
 * invocado solo por POST .../adopt).
 *
 * Espeja el PATRÓN DE LLAMADA de `scorerEngine` (session.create + prompt con
 * json_schema + transporte único agentTransport + mock inyectable, jobs vía
 * workItemStore + `scores.json` vía `readScores`) SIN copiar su lógica de
 * scoring: acá el LLM analiza failures agrupados, no juzga jobs.
 *
 * Escrituras: SOLO `factory/.proposals/<id>.json` (metadata de la propuesta)
 * y, en adopt, el target + `.proposals/<id>.bak`. El análisis y los GETs no
 * tocan disco. Ante cualquier fallo LLM/parse/allowlist la propuesta queda
 * `failed` con `failureReason` visible: NUNCA se inventa contenido.
 *
 * Directorio base testeable: TODA lectura/escritura bajo `factory/` pasa por
 * `resolveFactoryPath`, que honra `process.env.TERMCANVAS_FACTORY_DIR`
 * (tests lo apuntan a un tmpdir; producción usa el default).
 * ELECCIÓN DOCUMENTADA: `agentLoader` no tiene un resolver de dir factory
 * (solo resolvers por-archivo contra el repo root: `resolveAgentFilePath`,
 * `resolveFactoryYamlPath`), así que el engine define el suyo propio acá
 * en vez de acoplar un import parcial.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAILURE_PROMPT_PREVIEW_MAX,
  IMPROVEMENT_MAX_CONTENT,
  ImprovementProposalSchema,
  isAdoptableTarget,
  toProposalSummary,
  validateImprovementProposal,
  type FailureCase,
  type ImprovementProposal,
  type ProposalSummary,
} from "../../shared/types/improvement";
import {
  readScores,
  resolveScorerModel,
} from "./scorerEngine";
import { loadScorer, type LoadedScorer } from "./scorerLoader";
import type { ScorerDefinition } from "../../shared/types/scorer";
import { opencodeServerManager } from "../opencodeServerManager";
import { promptInSessionWithCost } from "../cost/promptWithCost";
import { isSessionNotFoundError } from "../sessions/agentSessions";
import { TAG_ANALYSIS, withPhaseTag } from "../llm/phaseTags";
import {
  SESSION_CREATE_FUSE_MS,
  attemptPromptOnce,
  parseSessionId,
  withTransportRetry,
} from "../llm/agentTransport";
import { workItemStore } from "../workItem/workItemStore";
import { ackNotification, notify } from "../notify/notifications";
import { checkAdoptGuards, checkDiscardGuards, checkRetryAnalysisGuards, isSafeProposalId } from "./improvementHttp";

/** Límite default de failures por propuesta. */
export const COLLECT_FAILURES_DEFAULT_LIMIT = 50;
// Turnos del análisis sin timeout por fase (doctrina agentTransport): el
// turno vive hasta el fusible global GLOBAL_AGENT_FUSE_MS.
/** Tope de jobs escaneados por colecta (acota el costo del barrido). */
export const MAX_JOBS_SCANNED = 200;
/** Casos incluídos en el prompt del análisis (acotados, los más recientes). */
export const ANALYSIS_PROMPT_MAX_CASES = 20;
/** Nombre del directorio de propuestas bajo `factory/`. */
export const PROPOSALS_DIR = ".proposals";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "");
}

// ── Error tipado (el endpoint lo convierte en 404/409) ──

export class ImprovementError extends Error {
  readonly code: 404 | 409;
  constructor(code: 404 | 409, message: string) {
    super(message);
    this.name = "ImprovementError";
    this.code = code;
  }
}

/** Narrowing para `unknown` → `ImprovementError`. Puro, nunca lanza. */
export function isImprovementError(e: unknown): e is ImprovementError {
  try {
    return (
      !!e &&
      typeof e === "object" &&
      (e as { name?: unknown }).name === "ImprovementError" &&
      ((e as { code?: unknown }).code === 404 || (e as { code?: unknown }).code === 409)
    );
  } catch {
    return false;
  }
}

// ── Raíz factory testeable ──

function getRepoRoot(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(currentFile), "../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {}
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "headless-runtime"))
    ) {
      return cwd;
    }
  } catch {}
  return process.cwd();
}

/**
 * Directorio base `factory/`: `TERMCANVAS_FACTORY_DIR` cuando está seteado
 * (tests), `<repo>/factory` por default. Nunca lanza.
 */
export function getFactoryBaseDir(): string {
  try {
    const env = process.env.TERMCANVAS_FACTORY_DIR;
    if (typeof env === "string" && env.trim().length > 0) {
      return path.resolve(env.trim());
    }
  } catch {}
  try {
    return path.join(getRepoRoot(), "factory");
  } catch {
    return path.join(process.cwd(), "factory");
  }
}

/**
 * Resuelve una ruta bajo el dir `factory/` (targets adoptables, `.proposals/`).
 * Único punto de acceso a disco bajo `factory/`. Nunca lanza.
 */
export function resolveFactoryPath(...parts: string[]): string {
  try {
    return path.join(getFactoryBaseDir(), ...parts);
  } catch {
    return path.join(process.cwd(), "factory", ...parts);
  }
}

/** Directorio de propuestas: `factory/.proposals`. Nunca lanza. */
export function getProposalsDir(): string {
  return resolveFactoryPath(PROPOSALS_DIR);
}

/** Genera un id de propuesta seguro para rutas y filenames. */
export function makeProposalId(): string {
  try {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return `imp-${t}-${r}`;
  } catch {
    return `imp-${Date.now()}-x`;
  }
}

// ── collectFailures ──

function clampLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isInteger(limit)) {
    return COLLECT_FAILURES_DEFAULT_LIMIT;
  }
  return Math.min(Math.max(limit, 1), 200);
}

/**
 * Recorre jobs (store + `scores.json` vía `readScores`), filtra los
 * `passing===false` del scorer y adjunta `promptPreview` (prompt slice 200).
 * Scorer inexistente/inválido o store ilegible → []. Más recientes primero.
 * Puro IO best-effort: nunca lanza.
 */
export function collectFailures(scorerName: string, limit = 50): FailureCase[] {
  try {
    if (typeof scorerName !== "string" || scorerName.trim().length === 0) return [];
    let loaded: LoadedScorer | null = null;
    try {
      loaded = loadScorer(scorerName.trim());
    } catch {
      return [];
    }
    if (!loaded) return [];
    const canonical = loaded.definition.name;
    const n = clampLimit(limit);
    let jobs: Array<{ id: string }>;
    try {
      jobs = workItemStore.list().slice(0, MAX_JOBS_SCANNED);
    } catch {
      return [];
    }
    const out: FailureCase[] = [];
    for (const job of jobs) {
      if (out.length >= n) break;
      try {
        const scores = readScores(job.id);
        const entry = scores[canonical];
        if (!entry || entry.passing !== false) continue;
        let prompt = "";
        try {
          const wi = workItemStore.get(job.id);
          if (wi && typeof wi.prompt === "string") prompt = wi.prompt;
        } catch {
          prompt = "";
        }
        out.push({
          workItemId: job.id,
          scorer: entry.scorer,
          label: String(entry.label ?? "").slice(0, 64) || "failing",
          reason: String(entry.reason ?? "").slice(0, 2000) || "(sin razón registrada)",
          at: typeof entry.at === "string" && entry.at.length > 0
            ? entry.at
            : new Date().toISOString(),
          promptPreview: prompt.slice(0, FAILURE_PROMPT_PREVIEW_MAX),
        });
      } catch {
        // job ilegible: se saltea
      }
    }
    try {
      out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    } catch {
      // orden best-effort
    }
    return out.slice(0, n);
  } catch {
    return [];
  }
}

// ── Prompt del análisis + json_schema ──

/**
 * Construye el prompt del análisis: definición del scorer + N casos
 * (job+label+reason+promptPreview, acotados) + INSTRUCCIÓN de que `target`
 * debe estar en el allowlist (`skills/...` o `agents/...` .md relativo a
 * `factory/`) y `newContent` el archivo COMPLETO propuesto (no diff).
 * Puro, nunca lanza.
 */
export function buildAnalysisPrompt(
  definition: ScorerDefinition,
  instructions: string,
  failures: FailureCase[],
): string {
  try {
    const cases = (Array.isArray(failures) ? failures : [])
      .slice(0, ANALYSIS_PROMPT_MAX_CASES)
      .map((f, i) => {
        const preview = (f.promptPreview || "(vacío)").slice(0, 200);
        return [
          `Caso ${i + 1}: job=${f.workItemId} label=${f.label} at=${f.at}`,
          `  reason: ${(f.reason || "(sin razón)").slice(0, 300)}`,
          `  prompt original (slice): """${preview}"""`,
        ].join("\n");
      })
      .join("\n");
    const total = Array.isArray(failures) ? failures.length : 0;
    return [
      `Sos el ANALISTA de self-improvement del scorer "${definition.name}". Agrupás failures recurrentes y proponés UNA mejora concreta a la factory.`,
      "",
      `Definición versionada del scorer (${definition.description}):`,
      String(instructions || "").trim().slice(0, 4000),
      "",
      "---",
      "",
      `Failures del scorer "${definition.name}" (passing=false, ${total} en total, se muestran hasta ${ANALYSIS_PROMPT_MAX_CASES}):`,
      cases || "(sin casos)",
      "",
      "Tu tarea: detectá el PATRÓN común (causa plausible: contexto faltante, instrucción ambigua, herramienta ausente) y proponé el archivo COMPLETO que lo corrige.",
      'REGLA DE TARGET (allowlist estricta): `target` debe ser una ruta relativa al dir `factory/`, dentro de `skills/` o `agents/`, terminada en `.md` (ej. `skills/code-review/SKILL.md`, `agents/review/agent.md`). Cualquier otro target será RECHAZADO.',
      "REGLA DE CONTENIDO: `newContent` es el archivo COMPLETO propuesto (no un diff, no un fragmento): debe poder escribirse tal cual sobre el target.",
      "REGLA DE TRAZA: `regressionsAddressed` lista los workItemIds de los casos que esta mejora corregiría (estilo Warp `Regressions addressed`).",
      "",
      'INSTRUCCIÓN DE FORMATO ESTRICTA: Responde SOLO JSON válido, sin texto antes ni después, keys exactas {"pattern","target","rationale","newContent","regressionsAddressed"}. Sin markdown, sin fences, sin explicación fuera del JSON.',
      "",
      "Analizá ahora y devolvé el JSON:",
    ].join("\n");
  } catch {
    return `{"pattern":"","target":"","rationale":"prompt build fallo","newContent":"","regressionsAddressed":[]}`;
  }
}

/**
 * json_schema strict para session.prompt del análisis.
 * Puro, nunca lanza.
 */
export function analysisJsonSchemaFor(): {
  type: "object";
  properties: {
    pattern: { type: "string"; description: string };
    target: { type: "string"; description: string };
    rationale: { type: "string"; description: string };
    newContent: { type: "string"; description: string };
    regressionsAddressed: {
      type: "array";
      items: { type: "string" };
      description: string;
    };
  };
  required: ["pattern", "target", "rationale", "newContent", "regressionsAddressed"];
  additionalProperties: false;
} {
  return {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Patrón común detectado en los failures (1-3 frases)",
      },
      target: {
        type: "string",
        description:
          "Ruta relativa a factory/ dentro de skills/ o agents/, terminada en .md",
      },
      rationale: {
        type: "string",
        description: "Por qué este cambio corrige el patrón (1-3 frases)",
      },
      newContent: {
        type: "string",
        description: "Archivo COMPLETO propuesto (no diff), máx 16KB",
      },
      regressionsAddressed: {
        type: "array",
        items: { type: "string" },
        description: "workItemIds de los failures que esta mejora corregiría",
      },
    },
    required: ["pattern", "target", "rationale", "newContent", "regressionsAddressed"],
    additionalProperties: false,
  };
}

export interface ParsedAnalysis {
  pattern: string;
  target: string;
  rationale: string;
  newContent: string;
  regressionsAddressed: string[];
}

/**
 * Parsea la respuesta cruda del análisis (strip fences, primer `{` último `}`)
 * y valida `{pattern, target, rationale, newContent ≤16KB,
 * regressionsAddressed ≥1}`. Lanza si es inválida — el caller convierte a
 * proposal `failed` (nunca se inventa contenido).
 */
export function parseAnalysisLLMResponse(raw: string): ParsedAnalysis {
  if (!raw || typeof raw !== "string") throw new Error("análisis LLM response vacía");
  let s = raw.trim();
  if (s.length === 0) throw new Error("análisis LLM response vacía");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    s = fence[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.substring(first, last + 1).trim();
  }
  if (!s.startsWith("{") || !s.endsWith("}")) {
    throw new Error(`análisis JSON parse error: no object — raw=${raw.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new Error(
      `análisis JSON parse error: ${e instanceof Error ? e.message : String(e)} — raw=${raw.slice(0, 200)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("análisis JSON parse error: no object");
  }
  const rec = parsed as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const pattern = str(rec.pattern).slice(0, 2000);
  const target = str(rec.target).slice(0, 300);
  const rationale = str(rec.rationale).slice(0, 2000);
  const newContentRaw = typeof rec.newContent === "string" ? rec.newContent : "";
  if (!pattern) throw new Error("análisis pattern vacío");
  if (!target) throw new Error("análisis target vacío");
  if (!rationale) throw new Error("análisis rationale vacío");
  if (!newContentRaw || newContentRaw.trim().length === 0) {
    throw new Error("análisis newContent vacío");
  }
  if (newContentRaw.length > IMPROVEMENT_MAX_CONTENT) {
    throw new Error(
      `análisis newContent excede ${IMPROVEMENT_MAX_CONTENT} (${newContentRaw.length})`,
    );
  }
  const regsRaw = rec.regressionsAddressed;
  if (!Array.isArray(regsRaw) || regsRaw.length === 0) {
    throw new Error("análisis regressionsAddressed vacío");
  }
  const regressionsAddressed = regsRaw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 200))
    .slice(0, 50);
  if (regressionsAddressed.length === 0) {
    throw new Error("análisis regressionsAddressed vacío");
  }
  return { pattern, target, rationale, newContent: newContentRaw, regressionsAddressed };
}

// ── Esqueleto LLM (patrón espejo de scorerEngine, código propio) ──

let sdkCache: boolean | null = null;
async function hasSdk(): Promise<boolean> {
  if (sdkCache !== null) return sdkCache;
  try {
    await import("@opencode-ai/sdk");
    sdkCache = true;
    return true;
  } catch {}
  try {
    await import("@opencode-ai/sdk/v2");
    sdkCache = true;
    return true;
  } catch {
    sdkCache = false;
    return false;
  }
}

export interface AnalysisPromptMockInput {
  scorerName: string;
  prompt: string;
  model: string;
}

/** Test seam: inyecta la respuesta del análisis sin red (igual que setScorerPromptMock). */
let analysisPromptMock:
  | ((input: AnalysisPromptMockInput) => Promise<string | null>)
  | null = null;
export function setAnalysisPromptMock(
  fn: ((input: AnalysisPromptMockInput) => Promise<string | null>) | null,
): void {
  analysisPromptMock = fn;
}

/**
 * Corre el análisis LLM real (session.create + prompt con json_schema +
 * escalera sync→legacy→async). Lanza con razón visible si falla — el caller
 * convierte a proposal `failed`.
 *
 * Ola 16: el create va en closure y la escalera toma sid; UNA llamada al
 * helper con rol "review" (el análisis califica el review como el juez) y
 * jobId = costKey (ver analyzeFailures: unánime → job real que persiste en
 * job.json + evento visible; mixto → `analysis/<scorer>`, memoria solo
 * porque el store ignora jobs inexistentes best-effort). El costo de Ola 15
 * queda ADENTRO de promptWith (1 análisis = 1 llamada lógica = 1 conteo).
 * Cero traga-errores por construcción: la escalera LANZA (nunca retorna
 * null silencioso) y promptWith no captura nada — el not-found viaja en el
 * mensaje final (`análisis LLM falló (...): <causa>`) que el helper detecta
 * para la renovación lazy. Cotas Regla 7: ≤1 create y ≤2 prompts (ver helper).
 */
async function runAnalysisLlm(
  promptText: string,
  modelStr: string,
  worktreeHint: string,
  costKey: string,
): Promise<string> {
  const slash = modelStr.indexOf("/");
  if (slash <= 0 || slash >= modelStr.length - 1) {
    throw new Error(`modelo de análisis inválido ("${modelStr}")`);
  }
  const providerID = modelStr.slice(0, slash);
  const modelID = modelStr.slice(slash + 1);
  const ok = await hasSdk();
  if (!ok) throw new Error("SDK no detectado: sin gastar LLM");
  let client: {
    session: {
      create: (o: unknown) => Promise<unknown>;
      prompt?: (a: unknown, b?: unknown) => Promise<unknown>;
      promptAsync?: (o: unknown) => Promise<unknown>;
    };
  };
  try {
    client = (await opencodeServerManager.ensureClient()) as unknown as typeof client;
  } catch (e) {
    const existing = opencodeServerManager.getClient() as unknown as typeof client | null;
    if (!existing) {
      throw new Error(`opencode server no disponible: ${errMsg(e).slice(0, 140)}`);
    }
    client = existing;
  }
  let directory = process.cwd();
  try {
    directory = path.resolve(worktreeHint || process.cwd());
  } catch {
    directory = process.cwd();
  }
  const title = "Self-improvement analysis";
  const createShapes: Array<Record<string, unknown>> = [
    { title, directory },
    { body: { title, directory } },
  ];
  // Ola 16: create extraído a closure byte a byte (loop acotado de 2 formas
  // intacto, mensajes intactos). El fallo LANZA igual que antes.
  const createAnalysisSession = async (): Promise<string> => {
    let sid: string | null = null;
    let createErr: unknown = null;
    for (const shape of createShapes) {
      try {
        const res: unknown = await withTransportRetry(
          () => client.session.create(shape),
          SESSION_CREATE_FUSE_MS,
          "improve session.create",
        );
        const cand = parseSessionId(res);
        if (cand) {
          sid = cand;
          break;
        }
        createErr = new Error("session.create sin sessionId");
      } catch (e) {
        createErr = e;
      }
    }
    if (!sid) {
      throw new Error(`improve session.create falló: ${errMsg(createErr).slice(0, 140)}`);
    }
    return sid;
  };
  const sessionAny = client.session as unknown as Record<string, unknown>;
  const promptFn = sessionAny.prompt as
    | ((a: unknown, b?: unknown) => Promise<unknown>)
    | undefined;
  const promptAsyncFn = sessionAny.promptAsync as
    | ((o: unknown) => Promise<unknown>)
    | undefined;
  if (typeof promptFn !== "function" && typeof promptAsyncFn !== "function") {
    throw new Error("session.prompt no disponible");
  }
  const body = {
    model: { providerID, modelID },
    parts: [{ type: "text", text: promptText }],
    json_schema: analysisJsonSchemaFor(),
  };
  // Ola 16: la escalera toma sid (no cierra sobre sessionId). YA lanzaba
  // ante fallo total (cero traga-errores): el mensaje final embebe la causa,
  // así el helper detecta el not-found y renueva UNA vez. UN solo intento
  // por turno (doctrina agentTransport): los rungs legacy idénticos se
  // eliminaron — cada reenvío clonaba el mensaje en la sesión.
  const runAnalysisLadder = async (sid: string): Promise<string> => {
    if (typeof promptFn === "function") {
      // Plano SDK 1.18.18 (ver reviewAgent.buildReviewPromptPayload):
      // el envelope {path,body} se dropea y hace 500 instantáneo.
      const out = await attemptPromptOnce(
        (signal) =>
          (promptFn as (a: unknown, b: unknown) => Promise<unknown>).call(
            client.session,
            { sessionID: sid, ...body },
            { signal },
          ),
        { label: "improve session.prompt", preferKey: "pattern", jobId: costKey, sessionId: sid },
      );
      if (out.raw) return out.raw;
      throw new Error(
        `análisis LLM falló: ${errMsg(out.lastErr || "sin respuesta").slice(0, 160)}`,
      );
    }
    if (typeof promptAsyncFn === "function") {
      const out = await attemptPromptOnce(
        () =>
          // Plano SDK 1.18.18 (mismo motivo que arriba).
          (promptAsyncFn as (o: unknown) => Promise<unknown>).call(client.session, {
            sessionID: sid,
            ...body,
          }),
        { label: "improve session.promptAsync", preferKey: "pattern", jobId: costKey, sessionId: sid },
      );
      if (out.raw) return out.raw;
      throw new Error(
        `análisis LLM falló: ${errMsg(out.lastErr || "sin respuesta").slice(0, 160)}`,
      );
    }
    throw new Error("análisis LLM falló: session.prompt no disponible");
  };
  // Ola 16: promptWith lleva el costo de Ola 15 ADENTRO (ortogonal) y NO
  // captura nada: el throw llega al retry not-found de abajo.
  const promptWithAnalysisSession = async (sid: string): Promise<string> =>
    promptInSessionWithCost(costKey, () => runAnalysisLadder(sid), promptText, body.model);
  // Análisis STATELESS (fix #69): sesión fresca por análisis, NUNCA reusar
  // la del reviewer (`job::review`). El análisis agregaba su prompt a la
  // conversación del review y la contaminaba. Cotas Regla 7: ≤1 create y
  // ≤2 prompts (create + 1 retry not-found).
  try {
    const freshSid = await createAnalysisSession();
    try {
      return await promptWithAnalysisSession(freshSid);
    } catch (e) {
      if (!isSessionNotFoundError(e)) throw e;
      const retrySid = await createAnalysisSession();
      return await promptWithAnalysisSession(retrySid);
    }
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e ?? "analysis failed"));
  }
}

// ── analyzeFailures ──

/**
 * Ola 15 cierre: clave de costo del análisis. El análisis agrega failures de
 * N jobs en UNA sola llamada LLM, así que no hay un job dueño obvio:
 * - si TODOS los failures son del mismo job → ese jobId (el gasto fue por
 *   sus regresiones: persiste en su `job.json` vía `refreshCostSummary`).
 * - si mezcla jobs o la lista viene vacía (este caso no llega al LLM: sale
 *   `failed` antes) → clave sintética `analysis/<scorer>` (cuenta en memoria;
 *   `refreshCostSummary` devuelve null al no existir en el store: compteur
 *   honesto sin atribución inventada a un job).
 * Pura, nunca lanza.
 */
export function resolveAnalysisCostKey(failures: FailureCase[], scorerName: string): string {
  try {
    const ids: string[] = [];
    const list = Array.isArray(failures) ? failures : [];
    for (const f of list) {
      const id = (f as FailureCase | null | undefined)?.workItemId;
      if (typeof id === "string" && id.length > 0 && !ids.includes(id)) ids.push(id);
    }
    if (ids.length === 1) return ids[0];
    const clean = typeof scorerName === "string" ? scorerName.trim() : "";
    return `analysis/${clean.length > 0 ? clean : "unknown"}`;
  } catch {
    return "analysis/unknown";
  }
}

export interface AnalysisDraft {  scorer: string;
  status: "ready" | "failed";
  pattern?: string;
  rationale?: string;
  target?: string;
  newContent?: string;
  regressionsAddressed: string[];
  failureReason?: string;
}

/**
 * Analiza failures agrupados con el LLM y devuelve el borrador de propuesta
 * (sin id): `ready` con pattern/target/rationale/newContent/regressionsAddressed,
 * o `failed` con `failureReason` visible. Fallo LLM, parse inválido o target
 * fuera del allowlist → `failed` (NUNCA propuesta inventada).
 * NO escribe nada en disco. Nunca lanza (imprevistos → failed).
 */
export async function analyzeFailures(
  scorerName: string,
  failures: FailureCase[],
): Promise<AnalysisDraft> {
  const failed = (reason: string): AnalysisDraft => ({
    scorer: String(scorerName ?? ""),
    status: "failed" as const,
    regressionsAddressed: [],
    failureReason: reason.slice(0, 500),
  });
  try {
    const loaded = loadScorer(scorerName);
    if (!loaded) return failed(`scorer no encontrado o inválido: ${scorerName}`);
    const definition = loaded.definition;
    const list = Array.isArray(failures) ? failures : [];
    if (list.length === 0) {
      return failed("sin failures para analizar: el scorer no tiene casos failing");
    }
    const resolved = resolveScorerModel(definition.model);
    if (!resolved) {
      return failed(
        `modelo del scorer inválido ("${definition.model}") y sin default usable`,
      );
    }
    const promptText = withPhaseTag(
      buildAnalysisPrompt(definition, loaded.instructions, list),
      TAG_ANALYSIS,
    );
    let raw: string | null = null;
    if (analysisPromptMock) {
      try {
        raw = await analysisPromptMock({
          scorerName: definition.name,
          prompt: promptText,
          model: resolved.modelStr,
        });
      } catch (e) {
        return failed(`mock/parse del análisis falló: ${errMsg(e).slice(0, 160)}`);
      }
      if (!raw) return failed("mock del análisis sin respuesta");
    } else {
      try {
        // Ola 16: el wrap de costo de Ola 15 vive ADENTRO de promptWith (ver
        // runAnalysisLlm); acá solo se resuelve la key existente: unánime →
        // job real (persiste), mixto → `analysis/<scorer>` (solo memoria).
        // El fallo del LLM lanza igual que antes (el catch lo convierte a
        // proposal `failed`).
        raw = await runAnalysisLlm(
          promptText,
          resolved.modelStr,
          process.cwd(),
          resolveAnalysisCostKey(list, definition.name),
        );
      } catch (e) {
        return failed(errMsg(e).slice(0, 300));
      }
    }
    let parsed: ParsedAnalysis;
    try {
      parsed = parseAnalysisLLMResponse(raw);
    } catch (e) {
      return failed(`análisis zod/parse falló: ${errMsg(e).slice(0, 200)}`);
    }
    if (!isAdoptableTarget(parsed.target)) {
      return failed(
        `target fuera del allowlist (debe ser skills/... o agents/... .md relativo a factory/): "${parsed.target.slice(0, 120)}"`,
      );
    }
    // regressionsAddressed honesto: solo ids presentes en los failures de
    // entrada; si el LLM no cita ninguno conocido, se linkean todos los de
    // entrada (son, por construcción, los que motivan la propuesta).
    const known = new Set(list.map((f) => f.workItemId));
    let regs = parsed.regressionsAddressed.filter((id) => known.has(id));
    if (regs.length === 0) {
      regs = list.map((f) => f.workItemId).slice(0, 50);
    }
    regs = [...new Set(regs)].slice(0, 50);
    return {
      scorer: definition.name,
      status: "ready",
      pattern: parsed.pattern,
      rationale: parsed.rationale,
      target: parsed.target,
      newContent: parsed.newContent,
      regressionsAddressed: regs,
    };
  } catch (e) {
    return {
      scorer: String(scorerName ?? ""),
      status: "failed" as const,
      regressionsAddressed: [],
      failureReason: `análisis inesperado: ${errMsg(e).slice(0, 200)}`,
    };
  }
}

// ── Persistencia: factory/.proposals/<id>.json (tmp→rename) ──

function writeFileAtomic(target: string, content: string): boolean {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.writeFileSync(tmp, content, "utf-8");
    } catch {
      return false;
    }
    try {
      fs.renameSync(tmp, target);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {}
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Persiste una propuesta (valida schema; tmp→rename atómico, best-effort).
 * Devuelve false si no pudo (schema inválido o disco). Nunca lanza.
 * Solo escribe bajo `factory/.proposals/` — jamás targets adoptables.
 */
export function persistProposal(proposal: ImprovementProposal): boolean {
  try {
    if (!proposal || typeof proposal !== "object") return false;
    const parsed = ImprovementProposalSchema.safeParse(proposal);
    if (!parsed.success) return false;
    const dir = getProposalsDir();
    const target = path.join(dir, `${parsed.data.id}.json`);
    return writeFileAtomic(target, JSON.stringify(parsed.data, null, 2));
  } catch {
    return false;
  }
}

/**
 * Relee una propuesta desde disco (id seguro + zod). Null si no existe o es
 * ilegible. Nunca lanza.
 */
export function readProposal(id: string): ImprovementProposal | null {
  try {
    if (typeof id !== "string" || id.length === 0 || id.length > 128) return null;
    if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
      return null;
    }
    const target = path.join(getProposalsDir(), `${id}.json`);
    if (!fs.existsSync(target)) return null;
    const raw = fs.readFileSync(target, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = ImprovementProposalSchema.safeParse(parsed);
    if (!validated.success) return null;
    if (validated.data.id !== id) return null;
    return validated.data;
  } catch {
    return null;
  }
}

/**
 * Lista todas las propuestas persistidas (las corruptas se omiten),
 * más recientes primero. Nunca lanza.
 */
export function listProposals(): ImprovementProposal[] {
  try {
    const dir = getProposalsDir();
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: ImprovementProposal[] = [];
    for (const entry of entries) {
      try {
        if (!entry.endsWith(".json")) continue;
        const id = entry.slice(0, -".json".length);
        const proposal = readProposal(id);
        if (proposal) out.push(proposal);
      } catch {
        // archivo roto: se omite
      }
    }
    try {
      out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    } catch {}
    return out;
  } catch {
    return [];
  }
}

/**
 * Lista resúmenes sin `newContent` (para GET lista). Nunca lanza.
 */
export function listProposalSummaries(): ProposalSummary[] {
  try {
    const out: ProposalSummary[] = [];
    for (const proposal of listProposals()) {
      try {
        const summary = toProposalSummary(proposal);
        if (summary) out.push(summary);
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

// ── createProposal (pending → análisis → ready/failed) ──

/**
 * Crea una propuesta `pending` y la persiste. Lanza `ImprovementError` 404 si
 * el scorer no existe. El análisis corre después vía `runAnalysisForProposal`
 * (el endpoint la dispara fire-and-forget tras el 201).
 */
export function createPendingProposal(scorerName: string): ImprovementProposal {
  const clean = typeof scorerName === "string" ? scorerName.trim() : "";
  if (!clean) throw new ImprovementError(404, "scorer requerido");
  const loaded = loadScorer(clean);
  if (!loaded) throw new ImprovementError(404, `scorer not found: ${clean}`);
  const proposal: ImprovementProposal = {
    id: makeProposalId(),
    scorer: loaded.definition.name,
    status: "pending",
    regressionsAddressed: [],
    createdAt: new Date().toISOString(),
  };
  const ok = persistProposal(proposal);
  if (!ok) throw new Error(`no se pudo persistir la propuesta ${proposal.id}`);
  return proposal;
}

/**
 * Corre el análisis para una propuesta `pending` y la actualiza a
 * `ready`/`failed` en disco. Si ya no está pending la devuelve tal cual
 * (idempotente ante doble disparo). Lanza `ImprovementError` 404 si el id
 * no existe; cualquier otro imprevisto queda como `failed` honesto.
 */
export async function runAnalysisForProposal(id: string): Promise<ImprovementProposal> {
  const current = readProposal(id);
  if (!current) throw new ImprovementError(404, `proposal not found: ${id}`);
  if (current.status !== "pending") return current;
  try {
    const failures = collectFailures(current.scorer);
    const draft = await analyzeFailures(current.scorer, failures);
    let updated: ImprovementProposal;
    if (draft.status === "ready") {
      updated = {
        id: current.id,
        scorer: current.scorer,
        status: "ready",
        pattern: draft.pattern ?? "",
        rationale: draft.rationale ?? "",
        target: draft.target ?? "",
        newContent: draft.newContent ?? "",
        regressionsAddressed: draft.regressionsAddressed,
        createdAt: current.createdAt,
      };
    } else {
      updated = {
        id: current.id,
        scorer: current.scorer,
        status: "failed",
        regressionsAddressed: [],
        createdAt: current.createdAt,
        failureReason: draft.failureReason ?? "análisis falló sin razón",
      };
    }
    try {
      validateImprovementProposal(updated);
    } catch (e) {
      updated = {
        id: current.id,
        scorer: current.scorer,
        status: "failed",
        regressionsAddressed: [],
        createdAt: current.createdAt,
        failureReason: `propuesta inválida tras análisis: ${errMsg(e).slice(0, 200)}`,
      };
    }
    persistProposal(updated);
    // Ola 19 (c) proposal ready → centro de notificaciones (1 línea
    // best-effort, sin workItemId único: la propuesta cita N jobs en
    // `regressionsAddressed`, jamás bloquea el análisis).
    try { if (updated.status === "ready") notify({ kind: "proposal-ready", title: "Propuesta lista para revisar", body: `propuesta ${updated.id} del scorer "${updated.scorer}" lista: ${String((updated as { target?: unknown }).target ?? "").slice(0, 300)}`.slice(0, 500) }); } catch {}
    return updated;
  } catch (e) {
    if (isImprovementError(e)) throw e;
    try {
      const failed: ImprovementProposal = {
        id: current.id,
        scorer: current.scorer,
        status: "failed",
        regressionsAddressed: [],
        createdAt: current.createdAt,
        failureReason: `análisis inesperado: ${errMsg(e).slice(0, 200)}`,
      };
      persistProposal(failed);
      return failed;
    } catch {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
}

/**
 * Atajo síncrono de conveniencia (tests / scripts): pending + análisis
 * await. En el daemon el endpoint usa `createPendingProposal` + fire-and-forget.
 */
export async function createProposal(scorerName: string): Promise<ImprovementProposal> {
  const pending = createPendingProposal(scorerName);
  return runAnalysisForProposal(pending.id);
}

// ── retryAnalysisForProposal (P4c: re-análisis humano de failed) ──

/**
 * Reserva atómica del presupuesto de retry-analysis (fix C-retry4).
 *
 * La carrera: dos POSTs solapados leían `retryCount=0`, ambos pasaban el
 * guard y ambos corrían `analyzeFailures`, pero el `retryCount` persistido
 * quedaba en 1 (check-then-act con el `await` del análisis en el medio:
 * `improvementEngine.ts` leía el presupuesto, esperaba al LLM y recién
 * después escribía el intento consumido).
 *
 * El fix reclama el intento ANTES de correr el análisis, en una sección
 * 100% sincrónica (read → guard → persist) sin ningún `await` intermedio:
 * Node ejecuta ese prefijo a completitud (run-to-completion en un solo
 * hilo), así que dos llamadas solapadas no pueden intercalarse ahí — la
 * primera persiste `retryCount=attempt` y la segunda lee el presupuesto ya
 * consumido y recibe 409 sin ejecutar ningún análisis.
 *
 * Por qué claim-sincrónico y no lock/cola con espera: el store es sync en
 * memoria + persist atómica tmp→rename, así que la sección crítica ya es
 * atómica por construcción del runtime — un mutex solo agregaría espera,
 * timers y una fila nueva en LOOPS.md sin ganar corrección. El perdedor
 * falla rápido con 409 (misma forma y mismos códigos que el guard
 * secuencial). God +0: no toca server/routeTable.
 *
 * Efecto visible: la propuesta queda `failed` con `retryCount` +
 * `lastRetriedAt` desde el claim (el intento queda consumido gane o pierda
 * el análisis, igual que antes); el re-análisis solo reescribe el resultado
 * sobre el mismo intento. Si el proceso muere entre claim y resultado, la
 * propuesta queda `failed` con el intento consumido — honesto, sin
 * re-análisis fantasma.
 *
 * 404 si no existe, 409 si el guard no pasa; lanza `Error` común solo si la
 * reserva no persiste (el endpoint lo convierte en 500 honesto).
 */
export function claimRetryAnalysisBudget(
  id: string,
):
  | { ok: true; current: ImprovementProposal; attempt: number; stamp: string }
  | { ok: false; code: 404 | 409; error: string } {
  const current = readProposal(id);
  if (!current) return { ok: false, code: 404 as const, error: `proposal not found: ${id}` };
  const guard = checkRetryAnalysisGuards(current, id);
  if (!guard.ok) return { ok: false, code: guard.code, error: guard.error };
  let used = 0;
  try {
    const raw = (current as { retryCount?: unknown }).retryCount;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) used = raw;
  } catch {
    used = 0;
  }
  const attempt = used + 1;
  const stamp = new Date().toISOString();
  const claimed: ImprovementProposal = {
    ...current,
    retryCount: attempt,
    lastRetriedAt: stamp,
  };
  if (!persistProposal(claimed)) {
    throw new Error(`no se pudo reservar el intento de re-análisis: ${id}`);
  }
  return { ok: true, current: claimed, attempt, stamp };
}

/**
 * Re-corre el análisis para una propuesta `failed` y la actualiza a
 * `ready`/`failed` honesto en disco. Precedente: `retry-review-only`
 * (H-005): re-corre SOLO la etapa flakeada sin re-correr el resto.
 *
 * - Solo si status=failed (otro estado → `ImprovementError` 409: jamás se
 *   re-analiza una propuesta ready/adopted/discarded/pending).
 * - Solo 1 retry-analysis por propuesta (`RETRY_ANALYSIS_MAX`; contar
 *   alcanzado → 409). Cada intento consumido queda en `retryCount` +
 *   `lastRetriedAt`, gane o pierda el análisis.
 * - Fix C-retry4: el intento se reclama con `claimRetryAnalysisBudget`
 *   ANTES de cualquier `await` (claim atómico sincrónico). Si el claim
 *   falla → 409 sin ejecutar el análisis: dos POSTs concurrentes → uno
 *   ejecuta, el otro ve 409, y `retryCount` queda exacto.
 * - Mismo engine (`analyzeFailures` sobre `collectFailures` frescos del
 *   mismo scorer), misma allowlist, misma disciplina de backup: el
 *   re-análisis NUNCA escribe targets, solo `.proposals/<id>.json`.
 * - Sin `decidedBy`: re-analizar no es decidir (igual que
 *   `createPendingProposal`); el humano decide después vía adopt/discard.
 * - Lanza `ImprovementError` 404 si el id no existe; cualquier otro
 *   imprevisto queda como `failed` honesto con el intento consumido.
 */
export async function retryAnalysisForProposal(id: string): Promise<ImprovementProposal> {
  const claim = claimRetryAnalysisBudget(id);
  if (!claim.ok) throw new ImprovementError(claim.code, claim.error);
  const { current, attempt, stamp } = claim;
  const stampAttempt = { retryCount: attempt, lastRetriedAt: stamp } as const;
  try {
    const failures = collectFailures(current.scorer);
    const draft = await analyzeFailures(current.scorer, failures);
    let updated: ImprovementProposal;
    if (draft.status === "ready") {
      updated = {
        id: current.id,
        scorer: current.scorer,
        status: "ready",
        pattern: draft.pattern ?? "",
        rationale: draft.rationale ?? "",
        target: draft.target ?? "",
        newContent: draft.newContent ?? "",
        regressionsAddressed: draft.regressionsAddressed,
        createdAt: current.createdAt,
        ...stampAttempt,
      };
    } else {
      updated = {
        id: current.id,
        scorer: current.scorer,
        status: "failed",
        regressionsAddressed: [],
        createdAt: current.createdAt,
        failureReason: draft.failureReason ?? "análisis falló sin razón",
        ...stampAttempt,
      };
    }
    try {
      validateImprovementProposal(updated);
    } catch (e) {
      updated = {
        id: current.id,
        scorer: current.scorer,
        status: "failed",
        regressionsAddressed: [],
        createdAt: current.createdAt,
        failureReason: `propuesta inválida tras re-análisis: ${errMsg(e).slice(0, 200)}`,
        ...stampAttempt,
      };
    }
    persistProposal(updated);
    try { if (updated.status === "ready") notify({ kind: "proposal-ready", title: "Propuesta lista para revisar", body: `propuesta ${updated.id} del scorer "${updated.scorer}" lista tras re-análisis: ${String((updated as { target?: unknown }).target ?? "").slice(0, 300)}`.slice(0, 500) }); } catch {}
    return updated;
  } catch (e) {
    if (isImprovementError(e)) throw e;
    try {
      const failed: ImprovementProposal = {
        id: current.id,
        scorer: current.scorer,
        status: "failed",
        regressionsAddressed: [],
        createdAt: current.createdAt,
        failureReason: `re-análisis inesperado: ${errMsg(e).slice(0, 200)}`,
        ...stampAttempt,
      };
      persistProposal(failed);
      return failed;
    } catch {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
}

// ── adopt / discard (único writer humano) ──

export interface AdoptResult {
  target: string;
  backup: string | null;
}

/**
 * Adopta una propuesta `ready`: ÚNICA escritura a `factory/skills|agents`.
 * - Solo si status=ready (si no → `ImprovementError` 404/409).
 * - Revalida el target contra el allowlist (defensa en profundidad).
 * - Backup del contenido actual a `factory/.proposals/<id>.bak` (si el
 *   target existe; si el backup falla se ABORTA sin escribir).
 * - Escribe `newContent` (tmp→rename) y marca adopted + decidedAt.
 * Fallos de disco lanzan `Error` común (el endpoint los convierte en 500).
 */
export function adoptProposal(id: string): AdoptResult {
  const current = readProposal(id);
  if (!current) throw new ImprovementError(404, `proposal not found: ${id}`);
  const guard = checkAdoptGuards(current, id);
  if (!guard.ok) throw new ImprovementError(guard.code, guard.error);
  const target = current.target ?? "";
  if (!isAdoptableTarget(target)) {
    throw new ImprovementError(
      409,
      `proposal target fuera del allowlist: "${String(target).slice(0, 120)}"`,
    );
  }
  const newContent = current.newContent ?? "";
  if (newContent.length === 0) {
    throw new ImprovementError(409, `proposal sin newContent: ${id}`);
  }
  const base = getFactoryBaseDir();
  const resolved = path.resolve(base, target);
  const rel = path.relative(base, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ImprovementError(409, `proposal target escapa factory/: ${id}`);
  }
  let previous: string | null = null;
  try {
    if (fs.existsSync(resolved)) {
      previous = fs.readFileSync(resolved, "utf-8");
    }
  } catch {
    previous = null;
  }
  let backup: string | null = null;
  if (previous !== null) {
    const backupRel = path.join(PROPOSALS_DIR, `${current.id}.bak`);
    const backupAbs = path.join(base, backupRel);
    const okBackup = writeFileAtomic(backupAbs, previous);
    if (!okBackup) {
      throw new Error(`backup falló, adopt abortado sin escribir: ${id}`);
    }
    backup = backupRel.split(path.sep).join("/");
  }
  const okWrite = writeFileAtomic(resolved, newContent);
  if (!okWrite) {
    throw new Error(`escritura del target falló: ${target}`);
  }
  const updated: ImprovementProposal = {
    ...current,
    status: "adopted",
    decidedAt: new Date().toISOString(),
    ...(backup ? { backupPath: backup } : {}),
  };
  if (!persistProposal(updated)) {
    throw new Error("adopt aplicado en disco pero el estado no persistió: revisá factory/.proposals");
  }
  return { target, backup };
}

/**
 * Descarta una propuesta `ready` (ready→discarded + decidedAt).
 * Id inexistente o estado inválido → `ImprovementError` 404/409.
 */
export function discardProposal(id: string): ImprovementProposal {
  const current = readProposal(id);
  if (!current) throw new ImprovementError(404, `proposal not found: ${id}`);
  const guard = checkDiscardGuards(current, id);
  if (!guard.ok) throw new ImprovementError(guard.code, guard.error);
  const updated: ImprovementProposal = {
    ...current,
    status: "discarded",
    decidedAt: new Date().toISOString(),
  };
  if (!persistProposal(updated)) {
    throw new Error("descarte no persistió en disco: revisá factory/.proposals");
  }
  return updated;
}

// ── F3-T2 — Adopt / discard from the notification (additive, never auto) ──
//
// The rodaje flow (plan §4.3): an auto-proposal born from genuine fails
// notifies `proposal-ready`; the human then Adopts or Discards FROM that
// notification (2 clicks, never auto). This block links the notification to
// the proposal it announces. Additive only:
// - No new auto path: both entry points require an explicit
//   `decidedBy: "human"`. Any other value (including "auto", "system",
//   "bot", "agent") throws ImprovementError 409 before anything is read.
// - No behavior change to adoptProposal / discardProposal: the guards
//   (ready-only), the allowlist revalidation, the backup discipline, and
//   the decidedAt stamping all stay inside those functions. This block only
//   resolves the proposal id from the notification and delegates.
// - Notification ack is best-effort and never blocks the decision: when the
//   notification carries a center id, it is acked after a successful
//   adopt/discard. Ack failure is reported as notificationAcked:false,
//   never thrown.

/** Notification kind that announces a ready proposal. */
export const PROPOSAL_READY_NOTIFICATION_KIND = "proposal-ready" as const;

/** First-match pattern for a proposal id inside notification text. */
export const PROPOSAL_ID_FROM_NOTIFICATION_PATTERN = /imp-[a-z0-9-]+/i;

/** Text fields scanned for the proposal id, in order (bounded). */
const PROPOSAL_NOTIFICATION_TEXT_FIELDS = [
  "proposalId",
  "proposal_id",
  "body",
  "title",
  "dedupeKey",
] as const;

/** Input of the from-notification decision entry points. */
export interface ProposalFromNotificationInput {
  notification: unknown;
  decidedBy: unknown;
}

/** Adopt outcome: the engine AdoptResult plus the notification linkage. */
export interface AdoptFromNotificationResult extends AdoptResult {
  proposalId: string;
  notificationAcked: boolean;
}

/** Discard outcome: the updated proposal plus the notification linkage. */
export interface DiscardFromNotificationResult {
  proposal: ImprovementProposal;
  proposalId: string;
  notificationAcked: boolean;
}

function firstProposalIdInText(text: unknown): string | null {
  try {
    if (typeof text !== "string") return null;
    const slice = text.slice(0, 2000);
    const match = PROPOSAL_ID_FROM_NOTIFICATION_PATTERN.exec(slice);
    if (!match || !match[0]) return null;
    const candidate = match[0];
    if (!isSafeProposalId(candidate)) return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Extracts the proposal id announced by a notification.
 * Accepts an explicit `proposalId`/`proposal_id` field first, then scans
 * body/title/dedupeKey text for the first `imp-…` id. The notification
 * center id (`n-…`) is never mistaken for a proposal id.
 * Pure, bounded to 5 fields. Never throws (null when not found).
 */
export function extractProposalIdFromNotification(notification: unknown): string | null {
  try {
    if (typeof notification === "string") return firstProposalIdInText(notification);
    if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
      return null;
    }
    const record = notification as Record<string, unknown>;
    for (const field of PROPOSAL_NOTIFICATION_TEXT_FIELDS) {
      let value: unknown = null;
      try {
        value = record[field];
      } catch {
        continue;
      }
      if (typeof value !== "string" || value.length === 0) continue;
      if (field === "proposalId" || field === "proposal_id") {
        const clean = value.trim().slice(0, 128);
        if (clean.length > 0 && isSafeProposalId(clean)) return clean;
        continue;
      }
      const found = firstProposalIdInText(value);
      if (found) return found;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the value looks like a `proposal-ready` notification.
 * Pure, never throws.
 */
export function isProposalReadyNotification(notification: unknown): boolean {
  try {
    if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
      return false;
    }
    return (notification as Record<string, unknown>).kind === PROPOSAL_READY_NOTIFICATION_KIND;
  } catch {
    return false;
  }
}

function requireHumanDecisorForProposalAction(decidedBy: unknown, action: string): void {
  try {
    if (decidedBy === "human") return;
  } catch {}
  throw new ImprovementError(
    409,
    `proposal ${action} requires decidedBy "human" — never auto (got ${typeof decidedBy === "string" ? `"${decidedBy.slice(0, 30)}"` : typeof decidedBy})`,
  );
}

function ackNotificationBestEffort(notification: unknown): boolean {
  try {
    if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
      return false;
    }
    const id = (notification as Record<string, unknown>).id;
    if (typeof id !== "string" || id.trim().length === 0) return false;
    try {
      return ackNotification(id);
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Adopts the proposal announced by a `proposal-ready` notification.
 * Requires `decidedBy: "human"` (never auto), requires the notification
 * kind, resolves the proposal id from the notification, then delegates to
 * adoptProposal (ready-only guards, allowlist, backup). The notification is
 * acked best-effort afterwards; ack failure is reported, never thrown.
 * Throws ImprovementError 404/409 on missing guards (same as adoptProposal).
 */
export function adoptProposalFromNotification(
  input: ProposalFromNotificationInput,
): AdoptFromNotificationResult {
  const notification = (input as ProposalFromNotificationInput | null | undefined)?.notification;
  const decidedBy = (input as ProposalFromNotificationInput | null | undefined)?.decidedBy;
  requireHumanDecisorForProposalAction(decidedBy, "adopt-from-notification");
  if (!isProposalReadyNotification(notification)) {
    throw new ImprovementError(
      409,
      `proposal adopt-from-notification requires a "proposal-ready" notification`,
    );
  }
  const proposalId = extractProposalIdFromNotification(notification);
  if (!proposalId) {
    throw new ImprovementError(404, `proposal id not found in notification`);
  }
  const adopted = adoptProposal(proposalId);
  const notificationAcked = ackNotificationBestEffort(notification);
  return { ...adopted, proposalId, notificationAcked };
}

/**
 * Discards the proposal announced by a `proposal-ready` notification.
 * Requires `decidedBy: "human"` (never auto), requires the notification
 * kind, resolves the proposal id from the notification, then delegates to
 * discardProposal (ready-only guards, decidedAt stamping). The notification
 * is acked best-effort afterwards; ack failure is reported, never thrown.
 * Throws ImprovementError 404/409 on missing guards (same as discardProposal).
 */
export function discardProposalFromNotification(
  input: ProposalFromNotificationInput,
): DiscardFromNotificationResult {
  const notification = (input as ProposalFromNotificationInput | null | undefined)?.notification;
  const decidedBy = (input as ProposalFromNotificationInput | null | undefined)?.decidedBy;
  requireHumanDecisorForProposalAction(decidedBy, "discard-from-notification");
  if (!isProposalReadyNotification(notification)) {
    throw new ImprovementError(
      409,
      `proposal discard-from-notification requires a "proposal-ready" notification`,
    );
  }
  const proposalId = extractProposalIdFromNotification(notification);
  if (!proposalId) {
    throw new ImprovementError(404, `proposal id not found in notification`);
  }
  const proposal = discardProposal(proposalId);
  const notificationAcked = ackNotificationBestEffort(notification);
  return { proposal, proposalId, notificationAcked };
}
