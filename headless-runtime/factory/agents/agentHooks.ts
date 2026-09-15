/**
 * AgentHooks — corredor genérico de agentes hook declarativos.
 *
 * Un agente nuevo se suma al pipeline SIN tocar código: declara `stage`
 * (`pre-build | post-build | post-review`) y `blocking` en su frontmatter y
 * el pipeline lo descubre por directorio (`factory/agents/*\/agent.md`) y lo
 * ejecuta en orden alfabético. `blocking: true` frena ante `fail`/`error`;
 * `blocking: false` (default, advisory) solo anexa evidencia al timeline.
 *
 * Ejecución: UN turno LLM por hook (sin renewal, sin reintentos: el fallo
 * cae a `error` y el caller aplica su fallo-sano). El contrato de salida es
 * estricto y chico: `{verdict: pass|fail, summary, findings[]}`.
 * Nunca lanza: el runner siempre devuelve resultados (aunque sea `error`).
 */

import fs from "node:fs";
import path from "node:path";
import {
  isOpencodeModelRef,
  parseAgentSkills,
  sessionAgentArgs,
} from "../opencodeAgentSync";
import {
  getAgentDefsRevision,
  isAgentStage,
  loadAgentDef,
  normalizeAgentBlocking,
  normalizeAgentStage,
  parseAgentFile,
  parseModelRef,
  type AgentStage,
} from "../agentLoader";
import { resolveFactoryAgentsDir } from "./agentFileRoutes";
import { opencodeServerManager, ensureAgentTurnClient } from "../../opencodeServerManager";
import { toolsetFromList, type Toolset } from "../../runner/toolPolicy";
import { workItemStore } from "../../workItem/workItemStore";
import { promptInSessionWithCost } from "../../cost/promptWithCost";
import {
  SESSION_CREATE_FUSE_MS,
  attemptJsonPromptOnce,
  isRetryableTransportError,
  parseSessionId,
  withTransportRetry,
} from "../../llm/agentTransport";
import { structuredFormat } from "../../llm/structuredOutput";
import { extractBalancedJSONObject } from "../../llm/jsonExtract";

export type HookStage = Exclude<AgentStage, "none">;

export const HOOK_STAGES: readonly HookStage[] = ["pre-build", "post-build", "post-review"];

export interface HookAgentDef {
  name: string;
  description: string;
  tools: Toolset;
  model: { providerID: string; modelID: string } | null;
  skills: string[];
  stage: HookStage;
  blocking: boolean;
  body: string;
}

export interface HookContext {
  workItemId: string;
  worktreePath: string;
  prompt: string;
  modelRef?: { providerID: string; modelID: string };
  createdFiles?: string[];
  extra?: string;
}

export type HookStatus = "pass" | "fail" | "error" | "skipped";

export interface HookFinding {
  message: string;
  file?: string;
  suggestion?: string;
}

export interface HookResult {
  name: string;
  stage: HookStage;
  blocking: boolean;
  status: HookStatus;
  summary: string;
  findings: HookFinding[];
  durationMs: number;
  /** SessionId efímera del turno (para VIEW AGENT; ausente = sin sesión). */
  sessionId?: string;
  /**
   * Diagnóstico técnico del fallo (causa del transporte/servidor + head
   * del raw). Solo en `error`: el summary sigue humano. Viaja en la meta
   * del evento timeline para que el próximo fallo sea investigable sin
   * adivinar.
   */
  detail?: string;
}

export interface HookRunnerSeams {
  /** Descubrimiento (default: lee factory/agents del disco). */
  listHookAgents?: (stage: HookStage) => HookAgentDef[];
  /** Ejecución de UN hook (default: turno LLM real). */
  runHookOnce?: (agent: HookAgentDef, ctx: HookContext) => Promise<HookResult>;
}

/**
 * Seam SOLO para tests: override global del runner (las suites offline
 * fijan `listHookAgents: () => []` para no gastar LLM). `null` = real.
 * Espejo de `setReviewPromptMock` / `setAgentSessionsOverrideForTests`.
 */
let hookSeamsOverride: HookRunnerSeams | null = null;

export function setHookSeamsForTests(seams: HookRunnerSeams | null): void {
  try {
    hookSeamsOverride = seams;
  } catch {
    // noop
  }
}

/** json_schema strict del contrato de salida del hook (va por format). */
export const hookJsonSchema = {
  type: "object" as const,
  properties: {
    verdict: {
      type: "string" as const,
      enum: ["pass", "fail"],
      description: "pass = el chequeo está verde; fail = hay hallazgos que frenan (si blocking)",
    },
    confidence: { type: "number" as const, minimum: 0, maximum: 1 },
    summary: { type: "string" as const, description: "resumen humano 1-3 frases" },
    findings: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
          message: { type: "string" as const },
          file: { type: "string" as const },
          suggestion: { type: "string" as const },
        },
        required: ["message"] as const,
        additionalProperties: false as const,
      },
    },
  },
  required: ["verdict", "confidence", "summary", "findings"] as const,
  additionalProperties: false as const,
};

/**
 * Seam SOLO para tests: dir alternativo de `factory/agents` (sandbox
 * hermético). `null` = dir real. Con override, el descubrimiento lee los
 * agent.md de ahí (no del repo) para poder probar alta/cambio de stage.
 */
let hookAgentsDirOverride: string | null = null;

export function setHookAgentsDirForTests(dir: string | null): void {
  try {
    hookAgentsDirOverride =
      typeof dir === "string" && dir.trim().length > 0 ? dir.trim() : null;
  } catch {
    hookAgentsDirOverride = null;
  }
}

function agentsDir(): string {
  if (hookAgentsDirOverride !== null) return hookAgentsDirOverride;
  try {
    return resolveFactoryAgentsDir();
  } catch {
    return path.resolve("factory", "agents");
  }
}

/** Lee una def desde el dir override (sandbox de tests). Nunca lanza. */
function readAgentDefFromDir(
  dir: string,
  name: string,
): ReturnType<typeof loadAgentDef> {
  try {
    const text = fs.readFileSync(path.join(dir, name, "agent.md"), "utf-8");
    const parsed = parseAgentFile(text);
    return { name, frontmatter: parsed.frontmatter, body: parsed.body };
  } catch {
    return null;
  }
}

/** Agente hook declarado: roster que el panel muestra (nombre + stage). */
export interface DeclaredHookAgent {
  name: string;
  stage: HookStage;
  blocking: boolean;
}

/**
 * TTL del roster sin bump de revisión: cubre ediciones por fuera de la app
 * (un archivo tocado a mano) dentro del próximo poll. Las escrituras por API
 * bumpean la revisión y se ven al instante.
 */
const DECLARED_AGENTS_TTL_MS = 2000;

let declaredAgentsCache: {
  revision: number;
  at: number;
  agents: DeclaredHookAgent[];
} | null = null;

/**
 * Roster completo de agentes hook (todos los stages), ordenado por stage
 * (pre-build → post-build → post-review) y nombre. Cacheado por revisión de
 * definiciones + TTL corto. A diferencia del cache viejo por mtime del dir,
 * editar el `stage` de un agente existente SÍ se ve (la revisión se bumpea
 * en cada escritura). Nunca lanza.
 */
export function listDeclaredHookAgents(): DeclaredHookAgent[] {
  try {
    const revision = getAgentDefsRevision();
    const now = Date.now();
    const hit = declaredAgentsCache;
    if (
      hit !== null &&
      hit.revision === revision &&
      now - hit.at < DECLARED_AGENTS_TTL_MS
    ) {
      return hit.agents.map((agent) => ({ ...agent }));
    }
    const agents: DeclaredHookAgent[] = [];
    for (const stage of HOOK_STAGES) {
      for (const def of discoverHookAgents(stage)) {
        agents.push({ name: def.name, stage: def.stage, blocking: def.blocking });
      }
    }
    declaredAgentsCache = { revision, at: now, agents };
    return agents.map((agent) => ({ ...agent }));
  } catch {
    try {
      return declaredAgentsCache !== null
        ? declaredAgentsCache.agents.map((agent) => ({ ...agent }))
        : [];
    } catch {
      return [];
    }
  }
}

/** Limpia el cache del roster (tests / invalidación explícita). */
export function resetHookAgentsCache(): void {
  declaredAgentsCache = null;
}

/** Stages con al menos un hook declarado (deriva del roster). Nunca lanza. */
export function listDeclaredHookStages(): HookStage[] {
  try {
    const stages: HookStage[] = [];
    for (const agent of listDeclaredHookAgents()) {
      if (!stages.includes(agent.stage)) stages.push(agent.stage);
    }
    return stages;
  } catch {
    return [];
  }
}

/**
 * Descubre agentes hook para un stage: barre `factory/agents/*\/agent.md`,
 * parsea con el loader (los rotos se ignoran: los reporta el validator) y
 * filtra por `stage` normalizado. Orden alfabético (determinista).
 * Nunca lanza.
 */
export function discoverHookAgents(stage: HookStage): HookAgentDef[] {
  const out: HookAgentDef[] = [];
  try {
    if (!isAgentStage(stage)) return out;
    let entries: string[];
    try {
      entries = fs.readdirSync(agentsDir()).slice().sort();
    } catch {
      return out;
    }
    for (const name of entries) {
      try {
        if (!/^[a-z0-9-]+$/i.test(name)) continue;
        const def =
          hookAgentsDirOverride !== null
            ? readAgentDefFromDir(hookAgentsDirOverride, name)
            : loadAgentDef(name);
        if (!def) continue;
        const fm = def.frontmatter as unknown as Record<string, unknown>;
        if (normalizeAgentStage(fm.stage) !== stage) continue;
        const tools = toolsetFromList(fm.tools);
        let model: HookAgentDef["model"] = null;
        try {
          const rawModel = typeof fm.model === "string" ? fm.model.trim() : "";
          if (rawModel && isOpencodeModelRef(rawModel)) {
            const parsed = parseModelRef(rawModel);
            if (parsed) model = { providerID: parsed.providerID, modelID: parsed.modelID };
          }
        } catch {
          model = null;
        }
        out.push({
          name,
          description: String(fm.description ?? "").slice(0, 300),
          tools,
          model,
          skills: parseAgentSkills(fm.skills),
          stage,
          blocking: normalizeAgentBlocking(fm.blocking),
          body: def.body,
        });
      } catch {
        // un agente roto nunca frena a los demás
      }
    }
  } catch {
    return out;
  }
  return out;
}

function buildHookPrompt(agent: HookAgentDef, ctx: HookContext): string {
  const files = (ctx.createdFiles ?? []).slice(0, 20);
  return [
    `WorkItem: ${ctx.workItemId}`,
    `Issue original: """${(ctx.prompt ?? "").slice(0, 2000)}"""`,
    `Worktree: ${ctx.worktreePath}`,
    files.length > 0 ? `Archivos del cambio:\n${files.map((f) => `- ${f}`).join("\n")}` : "Archivos del cambio: (descubrilos con read/glob/grep)",
    ctx.extra ? `Contexto de la fase:\n${ctx.extra.slice(0, 1000)}` : "",
    "",
    "Ejecutá tu chequeo con tools y cerrá con prosa breve + UN bloque ```json",
    'con keys exactas {"verdict","confidence","summary","findings"}.',
    'verdict = "pass" si está verde, "fail" si hay hallazgos.',
  ].join("\n");
}

export function parseHookResponse(raw: unknown): { verdict: "pass" | "fail"; summary: string; findings: HookFinding[] } | null {
  try {
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    const extracted = extractBalancedJSONObject(raw, ["verdict"]);
    if (extracted === null) return null;
    const parsed = JSON.parse(extracted) as Record<string, unknown>;
    if (parsed.verdict !== "pass" && parsed.verdict !== "fail") return null;
    const findings: HookFinding[] = [];
    if (Array.isArray(parsed.findings)) {
      for (const f of (parsed.findings as unknown[]).slice(0, 20)) {
        if (!f || typeof f !== "object" || Array.isArray(f)) continue;
        const fr = f as Record<string, unknown>;
        if (typeof fr.message !== "string" || fr.message.trim().length === 0) continue;
        const one: HookFinding = { message: fr.message.trim().slice(0, 1000) };
        if (typeof fr.file === "string" && fr.file.trim()) one.file = fr.file.trim().slice(0, 256);
        if (typeof fr.suggestion === "string" && fr.suggestion.trim()) one.suggestion = fr.suggestion.trim().slice(0, 1000);
        findings.push(one);
      }
    }
    return {
      verdict: parsed.verdict,
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 1000) : "",
      findings,
    };
  } catch {
    return null;
  }
}

async function runHookLlm(agent: HookAgentDef, ctx: HookContext): Promise<HookResult> {
  const started = Date.now();
  let sessionId: string | undefined;
  const done = (status: HookStatus, summary: string, findings: HookFinding[] = [], detail?: string): HookResult => ({
    name: agent.name,
    stage: agent.stage,
    blocking: agent.blocking,
    status,
    summary: summary.slice(0, 1000),
    findings,
    durationMs: Date.now() - started,
    ...(sessionId ? { sessionId } : {}),
    ...(detail ? { detail: detail.slice(0, 500) } : {}),
  });
  // Turno con config fresca: singleton si sigue vigente; server scopeado
  // recién nacido si la config de agentes cambió (fix PLATANO fuera del engine).
  let closeTurn: () => void = () => {};
  try {
    let client: {
      session: {
        create: (o: unknown) => Promise<unknown>;
        prompt?: (a: unknown, b?: unknown) => Promise<unknown>;
      };
    };
    try {
      const turn = await ensureAgentTurnClient();
      client = turn.client as unknown as typeof client;
      closeTurn = turn.close;
    } catch {
      const existing = opencodeServerManager.getClient() as unknown as typeof client | null;
      if (!existing) return done("error", "opencode server no disponible");
      client = existing;
    }
    const model = agent.model ?? ctx.modelRef ?? { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" };
    const promptText = buildHookPrompt(agent, ctx);
    const directory = path.resolve(ctx.worktreePath);
    const title = `Hook ${agent.stage}/${agent.name} ${ctx.workItemId}`;
    let sid: string | null = null;
    try {
      const res: unknown = await withTransportRetry(
        () => client.session.create({ title, directory, ...sessionAgentArgs(agent.name) }),
        SESSION_CREATE_FUSE_MS,
        `hook ${agent.name} session.create`,
      );
      sid = parseSessionId(res);
    } catch {
      sid = null;
    }
    if (!sid) {
      try {
        const res2: unknown = await withTransportRetry(
          () => client.session.create({ body: { title, directory } }),
          SESSION_CREATE_FUSE_MS,
          `hook ${agent.name} session.create body`,
        );
        sid = parseSessionId(res2);
      } catch {
        sid = null;
      }
    }
    if (!sid) return done("error", "session.create sin sessionId");
    sessionId = sid;
    const sessionAny = client.session as unknown as Record<string, unknown>;
    const promptFn = sessionAny.prompt as ((a: unknown, b?: unknown) => Promise<unknown>) | undefined;
    if (typeof promptFn !== "function") return done("error", "session.prompt no disponible");
    const full = {
      sessionID: sid,
      model: { providerID: model.providerID, modelID: model.modelID },
      tools: { ...agent.tools } as unknown as Record<string, unknown>,
      ...sessionAgentArgs(agent.name),
      parts: [{ type: "text", text: promptText }],
      format: structuredFormat(hookJsonSchema),
    };
    // UN intento + UN reintento solo ante error de transporte (timeouts y
    // aborts nunca se reenvían: el modelo podía seguir pensando). Sin el
    // reintento, un hipo del server efímero bajo carga voltea el hook.
    const attemptOnce = (): Promise<{ raw: string | null; lastErr: unknown }> =>
      promptInSessionWithCost(
        ctx.workItemId,
        () =>
          attemptJsonPromptOnce(
            (signal, payload) =>
              (promptFn as (a: unknown, b: unknown) => Promise<unknown>).call(client.session, payload, { signal }),
            { payload: full, label: `hook ${agent.name} session.prompt`, preferKey: "verdict", jobId: ctx.workItemId, sessionId: sid },
          ),
        promptText,
        model,
      ) as Promise<{ raw: string | null; lastErr: unknown }>;
    let raw: string | null = null;
    let lastErr: unknown = null;
    try {
      const first = await attemptOnce();
      raw = typeof first === "string" ? first : (first?.raw ?? null);
      lastErr = typeof first === "string" ? null : (first?.lastErr ?? null);
      if (raw === null && isRetryableTransportError(lastErr)) {
        const second = await attemptOnce();
        raw = typeof second === "string" ? second : (second?.raw ?? null);
        lastErr = typeof second === "string" ? lastErr : (second?.lastErr ?? lastErr);
      }
    } catch (e) {
      lastErr = e;
      raw = null;
    }
    if (raw === null && lastErr !== null) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      return done("error", `hook prompt fallo: ${msg.slice(0, 160)}`, [], `prompt: ${msg.slice(0, 300)}`);
    }
    const parsed = parseHookResponse(raw);
    if (!parsed) {
      const rawHead = typeof raw === "string" && raw.trim().length > 0 ? raw.trim().slice(0, 200) : "(vacío)";
      const errPart = lastErr !== null
        ? ` causa: ${(lastErr instanceof Error ? lastErr.message : String(lastErr)).slice(0, 200)}`
        : "";
      return done("error", "respuesta sin JSON parseable (verdict pass|fail)", [], `raw: ${rawHead}${errPart}`);
    }
    return done(parsed.verdict, parsed.summary || `hook ${parsed.verdict}`, parsed.findings);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return done("error", `hook throw: ${msg.slice(0, 160)}`);
  } finally {
    // Teardown del server efímero del turno (no-op si corrió en el singleton).
    try {
      closeTurn();
    } catch {
      // best-effort
    }
  }
}

/**
 * Corre los hooks de un stage en orden. Nunca lanza: cada hook resuelve a
 * pass/fail/error/skipped y deja su evento en el timeline del job.
 * `skipped` = descubrimiento vacío (sin agentes para el stage: costo cero).
 */
export async function runStageHooks(
  stage: HookStage,
  ctx: HookContext,
  seams?: HookRunnerSeams,
): Promise<HookResult[]> {
  const out: HookResult[] = [];
  try {
    const active = seams ?? hookSeamsOverride;
    let agents: HookAgentDef[];
    try {
      agents = active?.listHookAgents ? active.listHookAgents(stage) : discoverHookAgents(stage);
    } catch {
      agents = [];
    }
    if (agents.length === 0) return out;
    const recordRun = (res: HookResult): void => {
      try {
        workItemStore.recordHookRun(ctx.workItemId, {
          name: res.name,
          stage: res.stage,
          status: res.status,
          blocking: res.blocking,
          ...(res.sessionId ? { sessionId: res.sessionId } : {}),
        });
      } catch {
        // resumen best-effort: el evento timeline ya quedó
      }
    };
    for (const agent of agents) {
      const started = Date.now();
      try {
        const res = active?.runHookOnce
          ? await active.runHookOnce(agent, ctx)
          : await runHookLlm(agent, ctx);
        out.push(res);
        recordRun(res);
        try {
          workItemStore.appendEvent(
            ctx.workItemId,
            "runner",
            `hook:${stage}:${agent.name}:${res.status} — ${res.summary.slice(0, 160)}${agent.blocking ? " (blocking)" : " (advisory)"}`,
            { hook: { name: res.name, stage: res.stage, blocking: res.blocking, status: res.status, findings: res.findings, ...(res.detail ? { detail: res.detail } : {}), ...(res.sessionId ? { sessionId: res.sessionId } : {}) } } as unknown as Record<string, unknown>,
          );
        } catch {
          // timeline best-effort
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const errRes: HookResult = {
          name: agent.name,
          stage: agent.stage,
          blocking: agent.blocking,
          status: "error",
          summary: `hook throw: ${msg.slice(0, 160)}`,
          findings: [],
          durationMs: Date.now() - started,
        };
        out.push(errRes);
        recordRun(errRes);
        try {
          workItemStore.appendEvent(ctx.workItemId, "runner", `hook:${stage}:${agent.name}:error — ${msg.slice(0, 160)}`, {
            hook: { name: agent.name, stage: agent.stage, blocking: agent.blocking, status: "error" as const },
          } as unknown as Record<string, unknown>);
        } catch {
          // timeline best-effort
        }
      }
    }
  } catch {
    // el runner jamás rompe el pipeline
  }
  return out;
}

/**
 * Agentes hook declarados para el panel: el activity muestra un chip por
 * agente bajo su lane desde el inicio del job (no solo post-ejecución) y
 * una fila deshabilitada en Agent Sessions. `hookStages` se mantiene por
 * compatibilidad (payloads viejos); `hookAgents` es la forma rica con el
 * nombre visible. Descubrimiento cacheado por revisión, nunca lanza.
 */
export function hookStagesExtras(): Record<string, unknown> {
  try {
    const agents = listDeclaredHookAgents();
    if (agents.length === 0) return {};
    const stages: HookStage[] = [];
    for (const agent of agents) {
      if (!stages.includes(agent.stage)) stages.push(agent.stage);
    }
    return { hookStages: stages, hookAgents: agents };
  } catch {
    return {};
  }
}

/** True si algún hook blocking falló o dio error (el caller frena). */
export function hasBlockingFailure(results: HookResult[]): boolean {
  try {
    return results.some((r) => r.blocking && (r.status === "fail" || r.status === "error"));
  } catch {
    return false;
  }
}
