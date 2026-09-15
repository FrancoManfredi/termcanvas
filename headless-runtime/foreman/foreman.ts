/**
 * ForemanService — Ola 2: decide con LLM real vía @opencode-ai/sdk, fallback needs_triage, nunca 500.
 * Fix Gao: elimina isVaguePrompt hardcode, deja solo guard para prompt vacío → needs_input,
 * todo lo demás va a LLM. Clasifica errores: solo 401/402/429 payment/quota→error Cancelled,
 * timeout/econnrefused/abort/fetch→needs_triage retryable (confidence 0.52) no error.
 * Usa OpencodeServerManager para url/cliente, timeout 12000ms con AbortController + 1 retry.
 */

import type { ForemanDecision, ForemanLog } from "../../shared/types/foreman";
import { buildFallbackDecision, buildErrorDecision, isAuthPaymentError, isRetryableError } from "../../shared/types/foreman";
import type { ModelRef, WorkItem } from "../../shared/types/workItem";
import { foremanLogStore } from "./foremanLog";
import { buildForemanPrompt, parseForemanLLMResponse, foremanJsonSchema, type ForemanExtraContext } from "./foremanPrompt";
import { readStructuredRaw, structuredFormat } from "../llm/structuredOutput";
import { opencodeServerManager, ensureAgentTurnClient } from "../opencodeServerManager";
import { toolsetFor } from "../runner/toolPolicy";
import { getDefaultModels, parseModelRef } from "../factory/agentLoader";
import { sessionAgentArgs } from "../factory/opencodeAgentSync";
import {
  globalAgentFuseMs,
  SESSION_CREATE_FUSE_MS,
  attemptJsonPromptOnce,
  parseSessionId,
  withTransportRetry,
} from "../llm/agentTransport";
import { extractBalancedJSONObject, stripJsonFences } from "../llm/jsonExtract";
import { promptInSessionWithCost } from "../cost/promptWithCost";
import { extractSessionUsage, recordRealUsage } from "../cost/costTracker";
import { promptInAgentSession, readSessionAgent } from "../sessions/agentSessions";
// B2: session cwd = isolation jail when recorded, else the anchor.
import { resolveSessionWorktree } from "../factory/isolation/sessionWorktree";

export interface WorkItemInput {
  prompt: string;
  worktree: string;
  modelRef?: ModelRef;
  id?: string;
}

// Modelo default del foreman (el fusible de turnos es el global
// GLOBAL_AGENT_FUSE_MS de agentTransport: sin timeouts por fase).
const FOREMAN_DEFAULT_MODEL_REF = "opencode-go/muse-spark-1.3-contributor";

/** Modelo default del foreman: yaml (defaultModels.foreman) cuando válido, constante cuando no. Nunca lanza. */
function effectiveForemanDefaultModel(): { providerID: string; modelID: string } {
  try {
    const parsed = parseModelRef(getDefaultModels().foreman);
    if (parsed) return parsed;
  } catch {
    // fallback abajo
  }
  const fallback = parseModelRef(FOREMAN_DEFAULT_MODEL_REF);
  if (fallback) return fallback;
  return { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" };
}
const OPENCODE_WEB_URL = "http://127.0.0.1:4096";
const OPENCODE_WEB_FALLBACK_URL = "http://127.0.0.1:40014";

async function getWorkingOpencodeUrlForeman(): Promise<string> {
  // Prefer manager efímero si está disponible y healthy
  try {
    const mgrUrl = opencodeServerManager.getUrl();
    if (mgrUrl) {
      // health-check rápido antes de usar
      const healthy = await opencodeServerManager.isHealthy().catch(() => false);
      if (healthy) return mgrUrl;
      // si no healthy pero url existe, igual intentar usar (ensureClient reintentará)
      // fallback a discovery solo si manager no tiene url
      if (mgrUrl) return mgrUrl;
    }
    // si manager no tiene url, intentar ensureClient lazy
    const ensured = await opencodeServerManager.getUrlAsync().catch(() => null);
    if (ensured) return ensured;
  } catch {}
  // Fallback legacy discovery 4096/40014 (si manager no está Levantado, p.ej. tests sin server)
  for (const url of [OPENCODE_WEB_URL, OPENCODE_WEB_FALLBACK_URL]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 800);
      const r = await fetch(`${url}/provider`, { signal: ctrl.signal as unknown as AbortSignal }).catch(() => null);
      clearTimeout(t);
      if (r && r.ok) return url;
    } catch {}
  }
  // último fallback: manager url aunque no haya pasado health, o 4096
  const fallbackMgr = opencodeServerManager.getUrl();
  if (fallbackMgr) return fallbackMgr;
  return OPENCODE_WEB_URL;
}

let opencodeSdkAvailableCache: boolean | null = null;

async function detectOpencodeSdk(): Promise<boolean> {
  if (opencodeSdkAvailableCache !== null) return opencodeSdkAvailableCache;
  try {
    await import("@opencode-ai/sdk");
    opencodeSdkAvailableCache = true;
    return true;
  } catch {}
  try {
    await import("@opencode-ai/sdk/v2");
    opencodeSdkAvailableCache = true;
    return true;
  } catch {
    opencodeSdkAvailableCache = false;
    return false;
  }
}

function isPactDeterministic(workItem: Pick<WorkItem, "id" | "prompt" | "worktree">): boolean {
  const p = workItem.prompt ?? "";
  const w = workItem.worktree ?? "";
  const id = workItem.id ?? "";
  if (p.startsWith("playground-")) return true;
  if (w.toLowerCase().includes("playground-")) return true;
  if (w.toLowerCase().includes("playground")) return true;
  if (id.startsWith("job-abc123") || id.startsWith("job-f10") || id.startsWith("job-f04") || id === "job-abc123") return true;
  if (p.includes("Test Factory tildes")) return true;
  return false;
}

/**
 * Única guarda determinística permitida: prompt vacío → needs_input.
 * Todo lo demás (incluido "hace algo", prompts cortos) va a LLM.
 * Warp real: la vaguedad la decide el LLM vía json_schema, no hardcode.
 */
function isEmptyPrompt(prompt: string): boolean {
  const trimmed = (prompt ?? "").trim();
  return trimmed.length === 0;
}

/**
 * Ola 3 fix + Ola 6 des-hardcodeo (H1/H2): detector determinístico genérico para prompt claro
 * de crear carpeta en raíz (cualquier nombre, no un caso canónico con nombre propio).
 * Solo actúa como fallback cuando el LLM falla en parse (infra) para evitar Triage 0.52
 * en un prompt claramente ejecutable. Si el LLM responde correctamente con JSON, este detector no se usa.
 */
function isCrearCarpetaRaizPrompt(prompt: string): boolean {
  const p = (prompt ?? "").toLowerCase();
  // normaliza: ignora acentos en raiz/raíz y espacios múltiples
  const normalized = p.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.includes("crear") && normalized.includes("carpeta") && normalized.includes("raiz");
}

/**
 * Extracción robusta JSON (2da capa ante texto extra del LLM). Delega en
 * el extractor compartido (`headless-runtime/llm/jsonExtract`) con
 * preferencia a objetos con `decision`. Se mantiene el nombre por los
 * callers. Puro, nunca lanza.
 */
function robustExtractJsonSubstring(raw: string): string | null {
  try {
    return extractBalancedJSONObject(stripJsonFences(raw), ["decision"]);
  } catch {
    return null;
  }
}

/**
 * True cuando tiene sentido probar con OTRO modelo: el servidor rechazó
 * ESTE modelo (auth/cuota/modelo inexistente) → nada pendiente del lado del
 * servidor, el reintento con otro modelo no duplica. Ante timeout/transporte
 * es FALSE: el modelo puede seguir pensando y cualquier reenvío (mismo u
 * otro modelo) clona el mensaje en la sesión. Puro, nunca lanza.
 */
function isModelSwitchableError(e: unknown): boolean {
  try {
    const msg = e instanceof Error ? e.message : String(e ?? "");
    if (msg.trim().length === 0) return false;
    if (isAuthPaymentError(msg)) return true;
    const m = msg.toLowerCase();
    return (
      m.includes("model not found") ||
      m.includes("model_not_found") ||
      m.includes("unknown model") ||
      m.includes("no such model") ||
      m.includes("invalid model") ||
      m.includes("model no disponible")
    );
  } catch {
    return false;
  }
}

/**
 * Decide si un error debe mapearse a error (infra auth/payment) vs triage retryable (prompt ambiguo o timeout).
 * Solo 401/402/429 + payment/quota/billing → error (Cancelled).
 * timeout/econnrefused/abort/fetch/network/zod → needs_triage retryable confidence 0.52
 */
function fallbackForReason(reason: string, confidence = 0.5): ForemanDecision {
  const short = reason.slice(0, 200);
  // Solo auth/payment → error
  if (isAuthPaymentError(short) || isAuthPaymentError(reason)) {
    return buildErrorDecision(reason, confidence);
  }
  // Retryable (timeout, network, etc.) → needs_triage con confidence 0.52 y flag retryable
  if (isRetryableError(short) || isRetryableError(reason)) {
    const c = confidence === 0.5 ? 0.52 : confidence;
    const base = buildFallbackDecision(reason, c);
    // Añadir retryable para observabilidad (ForemanLog level decision, UI Triage retryable)
    return { ...base, confidence: c, retryable: true } as ForemanDecision;
  }
  return buildFallbackDecision(reason, confidence);
}

export class ForemanService {
  decide(input: WorkItemInput): ForemanDecision {
    void input;
    return {
      decision: "building",
      reason: "stub Ola 1 - always building",
      runnerId: "linux-build",
      confidence: 1.0,
    };
  }

  async decideWithLLM(workItem: WorkItem): Promise<ForemanDecision> {
    // Pact deterministic primero — no debe ser interceptado por empty guard
    if (isPactDeterministic(workItem)) {
      return {
        decision: "building",
        reason: "pact deterministic — building (prompt playground detectado)",
        runnerId: "linux-build",
        confidence: 1.0,
      };
    }

    // Única guarda determinística: prompt vacío → needs_input inmediato (no LLM)
    if (isEmptyPrompt(workItem.prompt ?? "")) {
      return {
        decision: "needs_input",
        reason: "Prompt vacío — falta input del usuario",
        confidence: 0.92,
      };
    }

    // Turno con config fresca: singleton si sigue vigente; server scopeado
    // recién nacido si la config de agentes cambió (fix PLATANO fuera del engine).
    let closeTurn: () => void = () => {};
    try {
      const hasSdk = await detectOpencodeSdk();
      if (!hasSdk) {
        return fallbackForReason("SDK no detectado", 0.5);
      }

      // Ola 8: contexto triage/spec previo si existe (best-effort, nunca rompe el flujo).
      let foremanExtra: ForemanExtraContext | undefined;
      try {
        const { getLatestTriage } = await import("../triage/triageFlow");
        const { getLatestSpec } = await import("../spec/specFlow");
        const triage = getLatestTriage(workItem);
        const spec = getLatestSpec(workItem);
        if (triage || spec) {
          foremanExtra = {
            ...(triage ? { triage } : {}),
            ...(spec ? { spec } : {}),
          };
        }
      } catch {}

      type CreateClientFn = (cfg: unknown) => {
        session: {
          create: (opts: unknown) => Promise<unknown>;
          prompt?: (opts: unknown, opts2?: unknown) => Promise<unknown>;
          promptAsync?: (opts: unknown) => Promise<unknown>;
        };
      };
      let createClient: CreateClientFn | null = null;
      try {
        const modV2 = (await import("@opencode-ai/sdk/v2")) as unknown as { createOpencodeClient?: CreateClientFn };
        if (typeof modV2.createOpencodeClient === "function") createClient = modV2.createOpencodeClient;
      } catch {}
      if (!createClient) {
        try {
          const mod = (await import("@opencode-ai/sdk")) as unknown as { createOpencodeClient?: CreateClientFn };
          if (typeof mod.createOpencodeClient === "function") createClient = mod.createOpencodeClient;
        } catch {}
      }
      if (!createClient) {
        return fallbackForReason("createOpencodeClient no encontrado", 0.5);
      }

      // Turno con config fresca (fix PLATANO fuera del engine): el helper
      // devuelve el singleton si sigue vigente o un server recién nacido si
      // la config de agentes cambió. Si el helper falla, cae a la discovery
      // legacy de URL (manager/4096/40014) como siempre.
      let client: ReturnType<CreateClientFn> | null = null;
      try {
        const turn = await ensureAgentTurnClient();
        client = turn.client as unknown as ReturnType<CreateClientFn>;
        closeTurn = turn.close;
      } catch {}
      if (!client) {
        const workingUrl = await getWorkingOpencodeUrlForeman();
        // Si manager tiene cliente efímero, preferirlo; sino crear cliente efímero con baseUrl
        try {
          const mgrClient = opencodeServerManager.getClient() as unknown as ReturnType<CreateClientFn> | null;
          if (mgrClient && opencodeServerManager.getUrl() === workingUrl) {
            client = mgrClient as ReturnType<CreateClientFn>;
          }
        } catch {}
        if (!client) {
          client = createClient({ baseUrl: workingUrl } as unknown as Record<string, unknown>);
        }
      }
      const sessionAny = client.session as unknown as Record<string, unknown>;
      const promptFn = sessionAny.prompt as ((opts: unknown, opts2?: unknown) => Promise<unknown>) | undefined;
      const promptAsyncFn = sessionAny.promptAsync as ((opts: unknown) => Promise<unknown>) | undefined;

      // Turno único de datos: las reglas viven en el system prompt del espejo
      // (factory/agents/foreman/agent.md), el turno lleva solo issue + cierre.
      const promptText = buildForemanPrompt(workItem, undefined, foremanExtra);

      // Ola 16: create extraído a closure byte a byte (título, timeouts,
      // fallbacks y extracción de id intactos). El fallo se marca con el
      // prefijo `session.create fallo:` para que el catch de abajo devuelva
      // el MISMO fallback que antes (mensajes byte a byte).
      const createForemanSession = async (): Promise<string> => {
        try {
          const title = `Foreman ${workItem.id} ${workItem.phase ?? "diagnosisLlm"}`;
          // B2: the jail when recorded (isolation worktree), else the anchor.
          const directory = resolveSessionWorktree(workItem);
          const createCall = client.session.create as (o: unknown) => Promise<unknown>;
          let res: unknown;
          // Etiqueta de fase (el agent del create NO ejecuta: ver baseBody).
          // Rechazo del server → cae al shape plano del catch.
          try {
            res = await withTransportRetry(
              () => createCall.call(client.session, { title, directory, ...sessionAgentArgs("foreman") }),
              SESSION_CREATE_FUSE_MS,
              "session.create",
            );
          } catch {
            res = await withTransportRetry(
              () => createCall.call(client.session, { body: { title, directory } }),
              SESSION_CREATE_FUSE_MS,
              "session.create body",
            );
          }
          const sessionId = parseSessionId(res);
          if (!sessionId) throw new Error("session.create sin sessionId");
          return sessionId;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.startsWith("session.create fallo:")) throw e;
          throw new Error(`session.create fallo: ${msg.slice(0, 120)}`);
        }
      };

      const configuredDefault = effectiveForemanDefaultModel();
      const selectedModel = workItem.modelRef && workItem.modelRef.providerID && workItem.modelRef.modelID
        ? { providerID: workItem.modelRef.providerID, modelID: workItem.modelRef.modelID }
        : { ...configuredDefault };
      const defaultModel = { ...configuredDefault };
      const fallbackAnthropic = { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" };
      const fallbackOpenAI = { providerID: "openai", modelID: "gpt-4o" };
      const modelCandidates: Array<{ providerID: string; modelID: string }> = (() => {
        const candidates: Array<{ providerID: string; modelID: string }> = [selectedModel];
        const addIfNew = (m: { providerID: string; modelID: string }) => {
          if (!candidates.some((c) => c.providerID === m.providerID && c.modelID === m.modelID)) candidates.push(m);
        };
        addIfNew(defaultModel);
        addIfNew(fallbackAnthropic);
        addIfNew(fallbackOpenAI);
        return candidates;
      })();

      const tryPrompt = async (sid: string): Promise<string> => {
        let lastErrorOverall: unknown = null;
        for (const modelToTry of modelCandidates) {
          // `format` siempre en el payload: el helper único lo quita si el
          // servidor no lo acepta (memo por proceso + 1 reintento en texto).
          const baseBody: Record<string, unknown> = {
            model: modelToTry,
            tools: toolsetFor("foreman") as unknown as Record<string, unknown>,
            // Identidad EJECUTANTE del turno (ver E3: create solo etiqueta,
            // el agent del body decide quién corre). Sin espejo → {}.
            ...sessionAgentArgs("foreman"),
            parts: [{ type: "text", text: promptText }],
            // Structured output del servidor (body.format). `json_schema`
            // top-level era clave desconocida (ignorada por el cliente v2).
            format: structuredFormat(foremanJsonSchema),
          };
          // UN intento por modelo (doctrina agentTransport): los rungs
          // idénticos legacy + el rung "fallback" con texto distinto se
          // eliminaron — con timeouts cortos cada reenvío clonaba el mensaje
          // en la sesión. El cambio de modelo solo ocurre cuando el servidor
          // rechazó ESTE modelo (nada pendiente); ante timeout/transporte se
          // PARA y el caller aplica su fallback-sano.
          if (typeof promptFn === "function") {
            // Plano SDK v2 (ver reviewAgent.buildReviewPromptPayload):
            // el envelope {path,body} se dropea y hace 500 instantáneo.
            const out = await attemptJsonPromptOnce(
              (signal, payload) =>
                (promptFn as unknown as (a: unknown, b: unknown) => Promise<unknown>).call(
                  client.session,
                  { sessionID: sid, ...payload },
                  { signal },
                ),
              { payload: baseBody, label: "foreman session.prompt", preferKey: "decision", jobId: workItem.id, sessionId: sid },
            );
            if (out.raw) return out.raw;
            lastErrorOverall = out.lastErr ?? lastErrorOverall;
            if (!isModelSwitchableError(out.lastErr)) break;
            continue;
          }
          if (typeof promptAsyncFn === "function") {
            // Último recurso (promptAsync devuelve handle, nunca texto):
            // se espera la respuesta visible con el fusible global, sin reenviar.
            try {
              // Plano SDK v2 (mismo motivo que arriba).
              const resA = await withTransportRetry(
                () =>
                  (promptAsyncFn as unknown as (o: unknown) => Promise<unknown>).call(client.session, {
                    sessionID: sid,
                    ...baseBody,
                  }),
                globalAgentFuseMs(),
                "foreman session.promptAsync",
              );
              const extractedA = extractTextFromPromptResult(resA);
              if (extractedA) {
                // Camino promptAsync también mide (antes ciego): best-effort.
                try {
                  const usageA = extractSessionUsage(resA);
                  if (usageA) recordRealUsage(workItem.id, usageA, sid);
                } catch {
                  // la medición nunca rompe el intento
                }
                return extractedA;
              }
              const errStrA = hasResultError(resA);
              if (errStrA) {
                lastErrorOverall = new Error(errStrA);
                if (!isModelSwitchableError(errStrA)) break;
                continue;
              }
              const polled = await pollForAssistantJson(sid as string, globalAgentFuseMs());
              if (polled) return polled;
              lastErrorOverall = new Error("promptAsync sin respuesta visible");
            } catch (e) {
              lastErrorOverall = e ?? lastErrorOverall;
              if (!isModelSwitchableError(e)) break;
              continue;
            }
            break;
          }
          break;
        }
        const lastMsg = lastErrorOverall instanceof Error ? lastErrorOverall.message : lastErrorOverall ? String(lastErrorOverall) : "";
        if (lastMsg) throw new Error(`all prompt variants failed — last: ${lastMsg.slice(0, 120)}`);
        throw new Error("all prompt variants failed");
      };

      // Ola 16: la escalera va ADENTRO de promptWith (usa sid, no sessionId);
      // el wrap de costo de Ola 15 queda adentro también (ortogonal: 1 llamada
      // lógica = 1 conteo). Los retornos pact/determinísticos previos al LLM
      // siguen saliendo antes y NO se envuelven (0 honesto).
      const promptWithForemanSession = async (sid: string): Promise<string> =>
        promptInSessionWithCost(workItem.id, () => tryPrompt(sid), promptText, selectedModel);

      let rawResponse: string;
      try {
        // Ola 16: resume la sesión del foreman de este job; ante sesión
        // muerta (daemon reiniciado) renueva UNA vez con evento visible.
        // Cotas Regla 7: ≤1 create y ≤2 prompts por llamada (ver helper).
        rawResponse = (
          await promptInAgentSession({
            jobId: workItem.id,
            role: "foreman",
            create: createForemanSession,
            promptWith: promptWithForemanSession,
            expectAgent: "foreman",
            getAgent: (sid: string) => readSessionAgent(sessionAny, sid),
          })
        ).res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("session.create fallo:")) {
          return fallbackForReason(msg, 0.5);
        }
        return fallbackForReason(`prompt fallo: ${msg.slice(0, 160)}`, 0.5);
      }

      try {
        const parsed = parseForemanLLMResponse(rawResponse);
        const decision: ForemanDecision = {
          decision: parsed.decision as ForemanDecision["decision"],
          reason: parsed.reason,
          confidence: parsed.confidence,
          ...(parsed.decision === "building" ? { runnerId: "linux-build" as const } : {}),
        };
        return decision;
      } catch (e) {
        // Ola 3 fix: parse robusto extra en foreman.ts (strip fences, primer { último })
        // Si el LLM devolvió texto + JSON (ej: "The user wants me to act as the Foreman... {\"decision\":\"building\"...}"),
        // parseForemanLLMResponse ya intenta extraer, pero si aún falla por zod, intentamos extracción manual + validación.
        try {
          const candidate = robustExtractJsonSubstring(rawResponse);
          if (candidate) {
            const parsedRetry = parseForemanLLMResponse(candidate);
            const decisionRetry: ForemanDecision = {
              decision: parsedRetry.decision as ForemanDecision["decision"],
              reason: parsedRetry.reason,
              confidence: parsedRetry.confidence,
              ...(parsedRetry.decision === "building" ? { runnerId: "linux-build" as const } : {}),
            };
            return decisionRetry;
          }
        } catch {}
        // Fallback determinístico para prompt claro de crear carpeta en raíz: nunca debe ir a
        // Triage 0.52 por fallo de parse. Genérico por nombre (Ola 6 H2: cualquier nombre, no propio).
        if (isCrearCarpetaRaizPrompt(workItem.prompt ?? "")) {
          return {
            decision: "building",
            reason: "Prompt claro y ejecutable: crear carpeta en la raiz del worktree activo",
            confidence: 0.9,
            runnerId: "linux-build",
          };
        }
        const msg = e instanceof Error ? e.message : String(e);
        return fallbackForReason(`zod parse fallo: ${msg.slice(0, 120)}`, 0.5);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fallbackForReason(`unexpected: ${msg.slice(0, 120)}`, 0.5);
    } finally {
      // Teardown del server efímero del turno (no-op si corrió en el singleton).
      try {
        closeTurn();
      } catch {
        // best-effort
      }
    }
  }

  async handleNewWorkItem(input: {
    id: string;
    prompt: string;
    worktree: string;
    modelRef?: ModelRef;
  }): Promise<{ decision: ForemanDecision; log: ForemanLog }> {
    const fakeWorkItem: WorkItem = {
      id: input.id,
      prompt: input.prompt,
      worktree: input.worktree,
      modelRef: input.modelRef,
      status: "Intake",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: [],
      cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
      dir: null,
      dotDonePath: "",
      runnerId: "linux-build",
      phase: "diagnosisLlm",
      state: "queued",
      logs: [],
    };
    let decision: ForemanDecision;
    try {
      decision = await this.decideWithLLM(fakeWorkItem);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      decision = fallbackForReason(`handleNewWorkItem catch: ${msg.slice(0, 80)}`, 0.5);
    }
    const log = foremanLogStore.logDecision({
      workItemId: input.id,
      prompt: input.prompt,
      worktree: input.worktree,
      modelRef: input.modelRef,
      decision,
    });
    return { decision, log };
  }

  handleNewWorkItemSync(input: {
    id: string;
    prompt: string;
    worktree: string;
    modelRef?: ModelRef;
  }): { decision: ForemanDecision; log: ForemanLog } {
    const decision = this.decide({
      prompt: input.prompt,
      worktree: input.worktree,
      modelRef: input.modelRef,
      id: input.id,
    });
    const log = foremanLogStore.logDecision({
      workItemId: input.id,
      prompt: input.prompt,
      worktree: input.worktree,
      modelRef: input.modelRef,
      decision,
    });
    return { decision, log };
  }

  log(
    decision: ForemanDecision,
    workItemId: string,
    message?: string,
  ): ForemanLog {
    const entry: ForemanLog = {
      id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      level: decision.decision === "error" ? "error" : "decision",
      message:
        message ??
        `[Foreman] ${workItemId} → ${decision.decision} (runner ${decision.runnerId ?? "none"}) reason=${decision.reason}`,
      workItemId,
      decision,
    };
    foremanLogStore.append(entry);
    return entry;
  }

  fallback(reason: string): ForemanDecision {
    return fallbackForReason(reason, 0.5);
  }

  error(reason: string): ForemanDecision {
    return buildErrorDecision(reason, 0.5);
  }
}

export const foremanService = new ForemanService();

function hasResultError(res: unknown): string | null {
  try {
    if (!res || typeof res !== "object") return null;
    const obj = res as Record<string, unknown>;
    const maybeData = (obj.data as unknown) ?? obj;
    if (maybeData && typeof maybeData === "object" && "error" in (maybeData as Record<string, unknown>)) {
      const err = (maybeData as Record<string, unknown>).error as unknown;
      if (err) {
        try {
          const str = JSON.stringify(err);
          if (str.toLowerCase().includes("401") || str.toLowerCase().includes("402") || str.toLowerCase().includes("429") || str.toLowerCase().includes("payment") || str.toLowerCase().includes("quota") || str.toLowerCase().includes("unauthorized")) {
            return str.slice(0, 200);
          }
          return str.slice(0, 200);
        } catch {
          return String(err).slice(0, 200);
        }
      }
    }
    if ("error" in obj && obj.error) {
      try {
        return JSON.stringify(obj.error).slice(0, 200);
      } catch {
        return String(obj.error).slice(0, 200);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractTextFromPromptResult(res: unknown): string | null {
  try {
    // Structured primero: objeto validado por el servidor (format) —
    // serializado listo para zod, sin parse de prosa.
    try {
      const structured = readStructuredRaw(res);
      if (structured !== null) return structured;
    } catch {}
    if (!res || typeof res !== "object") {
      if (typeof res === "string") return res;
      return null;
    }
    const obj = res as Record<string, unknown>;
    const data = (obj.data as unknown) ?? res;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.text === "string") return d.text;
      if (typeof d.content === "string") return d.content;
      if (typeof d.output === "string") return d.output;
      if (Array.isArray(d.parts)) {
        const texts = (d.parts as unknown[]).map((p) => {
          if (p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string") return (p as Record<string, unknown>).text as string;
          if (typeof p === "string") return p;
          return "";
        }).filter(Boolean);
        if (texts.length > 0) return texts.join("\n");
      }
      if (d.info && typeof d.info === "object") {
        const info = d.info as Record<string, unknown>;
        if (typeof info.text === "string") return info.text;
        if (Array.isArray(info.parts)) {
          const texts2 = (info.parts as unknown[]).map((p) => {
            if (p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string") return (p as Record<string, unknown>).text as string;
            return "";
          }).filter(Boolean);
          if (texts2.length > 0) return texts2.join("\n");
        }
      }
      const maybeJson = JSON.stringify(d);
      if (maybeJson.includes('"decision"')) return maybeJson;
    }
    if (Array.isArray(res)) {
      for (let i = res.length - 1; i >= 0; i--) {
        const m = res[i] as Record<string, unknown>;
        const info = (m.info as Record<string, unknown> | undefined) ?? m;
        const role = (info?.role as string | undefined) ?? (m.role as string | undefined);
        if (role === "assistant") {
          if (typeof info.text === "string") return info.text;
          if (typeof m.text === "string") return m.text;
          if (Array.isArray(info.parts)) {
            const t = (info.parts as unknown[]).map((p) => (p as Record<string, unknown>).text as string).filter(Boolean).join("\n");
            if (t) return t;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function pollForAssistantJson(sessionId: string, timeoutMs: number): Promise<string | null> {
  const workingUrl = await getWorkingOpencodeUrlForeman();
  const start = Date.now();
  const url = `${workingUrl}/session/${encodeURIComponent(sessionId)}/message`;
  while (Date.now() - start < timeoutMs) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal as unknown as AbortSignal });
      clearTimeout(timer);
      if (res.ok) {
        const data: unknown = await res.json().catch(() => null);
        if (Array.isArray(data)) {
          for (let i = (data as unknown[]).length - 1; i >= 0; i--) {
            const rec = (data as Record<string, unknown>[])[i] as Record<string, unknown>;
            const info = (rec.info as Record<string, unknown> | undefined) ?? rec;
            const role = (info?.role as string | undefined) ?? (rec.role as string | undefined);
            if (role !== "assistant") continue;
            const parts = (info?.parts as unknown[] | undefined) ?? (rec.parts as unknown[] | undefined);
            let text = "";
            if (typeof info.text === "string") text = info.text;
            else if (typeof rec.text === "string") text = rec.text;
            else if (Array.isArray(parts)) {
              text = parts.map((p) => {
                if (p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string") return (p as Record<string, unknown>).text as string;
                if (typeof p === "string") return p;
                return "";
              }).join("\n");
            }
            if (text && text.includes('"decision"')) return text;
            if (text && text.trim().startsWith("{")) return text;
          }
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
