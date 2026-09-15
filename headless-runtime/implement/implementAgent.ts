/**
 * ImplementAgent — flujo simple (4 pasos, sin reintentos).
 * Consume ImplementInput {prompt, worktreePath, modelRef, id} y corre UN
 * solo turno LLM con tools. Sin strict second pass, sin reenvíos de
 * escalera, sin patch-apply ni fallback fantasma: si el turno no toca
 * archivos, el consume termina con lista vacía y el service deja el job
 * parado en Building (falla ahí, sin mover a Triage).
 * Cada rama agrega un trace event explícito que el service espeja al
 * timeline. Pacts, IMPLEMENT_MAX_FILES_MINIMAL, rollbackIfExceeds y
 * timeouts intactos.
 */

import fs from "node:fs";
import path from "node:path";
import { buildImplementPrompt } from "./implementPrompt";
import {
  fallbackMinimalChange,
  getFilteredCreatedFiles,
  rollbackIfExceeds,
  truncateModelSnippet,
} from "./minimalChange";
import type {
  ImplementInput,
  ImplementOutput,
  ImplementTraceBranch,
  ImplementTraceEvent,
} from "../../shared/types/implement";
import {
  IMPLEMENT_LLM_TIMEOUT_MS,
  IMPLEMENT_MAX_FILES_MINIMAL,
  IMPLEMENT_PROGRESS_IDLE_MS,
  IMPLEMENT_PROGRESS_POLL_MS,
} from "../../shared/types/implement";
import type { WorkItem } from "../../shared/types/workItem";
import { opencodeServerManager, ensureAgentTurnClient } from "../opencodeServerManager";
import { toolsetFor } from "../runner/toolPolicy";
import { getDefaultModels, parseModelRef } from "../factory/agentLoader";
import { sessionAgentArgs } from "../factory/opencodeAgentSync";
import { promptInSessionWithCost } from "../cost/promptWithCost";
import { extractSessionUsage, recordRealUsage } from "../cost/costTracker";
import { isSessionNotFoundError, promptInAgentSession, readSessionAgent } from "../sessions/agentSessions";
import { withTimeout } from "../llm/agentTransport";

/**
 * Modelo builder default efectivo: factory.yaml cuando válido, constante cuando no.
 * Nunca lanza.
 */
function effectiveBuilderDefaultModel(): { providerID: string; modelID: string } {
  try {
    const parsed = parseModelRef(getDefaultModels().builder);
    if (parsed) return parsed;
  } catch {}
  return { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" };
}

// Warp tools for Implement (Gao §1.2) — single source: runner/toolPolicy.
// The literal lives in toolPolicy; here it is requested by role (the
// "only the runner writes" gate).
const IMPLEMENT_TOOLS: Record<string, boolean> = toolsetFor("implement");

/**
 * Offline seams for tests (optional second consume arg). Production callers
 * omit it and get the real SDK/git path byte for byte. Lets suites drive
 * every branch with tmp worktrees, zero network, zero daemon.
 */
export interface ImplementAgentSeams {
  /** Force the SDK-availability verdict instead of importing the SDK. */
  hasSdk?: boolean;
  /** Replace the model call; receives the strict-second-pass flag. */
  runPrompt?: (opts: { strictSecondPass: boolean }) => Promise<string>;
}

let opencodeSdkAvailableCache: boolean | null = null;

export interface PromptProgressMetric {
  parts: number;
  textLen: number;
}

export interface PromptWithProgressOpts {
  /** Arranca el POST; recibe el AbortSignal para abortar en idle/absoluto. */
  start: (signal: AbortSignal) => Promise<unknown>;
  /** Sondea progreso; null = sondeo fallido (no avanza ni resetea el reloj). */
  poll: () => Promise<PromptProgressMetric | null>;
  idleMs?: number;
  absoluteMs?: number;
  intervalMs?: number;
  label?: string;
}

/**
 * Espera un turno LLM con techo por PROGRESO en vez de techo fijo: mientras
 * el modelo emita partes/texto el turno vive (hasta el absoluto); sin
 * progreso nuevo por idleMs se aborta (colgado). Verificado en vivo
 * 2026-09-07: las partes parciales son visibles vía messages() durante la
 * generación. Timers siempre limpiados al asentar; el abort corta el fetch.
 * Nunca lanza errores ajenos: propaga el del POST o los de idle/absoluto.
 */
export function awaitPromptWithProgress(
  opts: PromptWithProgressOpts,
): Promise<unknown> {
  const idleMs =
    typeof opts.idleMs === "number" && opts.idleMs > 0
      ? opts.idleMs
      : IMPLEMENT_PROGRESS_IDLE_MS;
  const absoluteMs =
    typeof opts.absoluteMs === "number" && opts.absoluteMs > 0
      ? opts.absoluteMs
      : IMPLEMENT_LLM_TIMEOUT_MS;
  const intervalMs =
    typeof opts.intervalMs === "number" && opts.intervalMs > 0
      ? opts.intervalMs
      : IMPLEMENT_PROGRESS_POLL_MS;
  const label =
    typeof opts.label === "string" && opts.label !== ""
      ? opts.label
      : "implement session.prompt";
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const t0 = Date.now();
    let lastProgress = t0;
    let lastMetric: PromptProgressMetric | null = null;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        try {
          clearTimeout(timer);
        } catch {}
        timer = undefined;
      }
      try {
        fn();
      } catch {}
    };
    const fail = (e: unknown): void => {
      settle(() => {
        try {
          controller.abort();
        } catch {}
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    };
    let started: Promise<unknown>;
    try {
      started = opts.start(controller.signal);
    } catch (e) {
      fail(e);
      return;
    }
    Promise.resolve(started).then(
      (v) => {
        settle(() => resolve(v));
      },
      (e) => {
        settle(() => reject(e instanceof Error ? e : new Error(String(e))));
      },
    );
    const tick = (): void => {
      if (settled) return;
      if (Date.now() - t0 > absoluteMs) {
        fail(new Error(`${label} absolute timeout (${absoluteMs}ms)`));
        return;
      }
      void (async () => {
        if (settled) return;
        let m: PromptProgressMetric | null = null;
        try {
          m = await opts.poll();
        } catch {
          m = null;
        }
        if (settled) return;
        if (
          m !== null &&
          (lastMetric === null ||
            m.parts > lastMetric.parts ||
            m.textLen > lastMetric.textLen)
        ) {
          lastMetric = m;
          lastProgress = Date.now();
        }
        if (Date.now() - lastProgress > idleMs) {
          fail(new Error(`${label} idle timeout (sin progreso ${idleMs}ms)`));
          return;
        }
        if (!settled) timer = setTimeout(tick, intervalMs);
      })();
    };
    timer = setTimeout(tick, intervalMs);
  });
}

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

export class ImplementAgent {
  /**
   * Consume implement input and produce minimal change Warp.
   * Strategy: try LLM minimal patch con tools, else fallback real.
   * Worktree debe ser el activo de termcanvas.
   */
  async consume(input: ImplementInput, seams?: ImplementAgentSeams): Promise<ImplementOutput> {
    const startMs = Date.now();
    const worktreePath = path.resolve(input.worktreePath);

    try {
      fs.mkdirSync(worktreePath, { recursive: true });
    } catch {}

    const startSnapshotMs = Date.now();
    const trace: ImplementTraceEvent[] = [];
    const pushTrace = (
      branch: ImplementTraceBranch,
      message: string,
      modelText?: string,
    ): void => {
      try {
        trace.push({
          branch,
          message,
          ...(modelText !== undefined && modelText.length > 0
            ? { modelSnippet: truncateModelSnippet(modelText) }
            : {}),
        });
      } catch {}
    };
    const finish = (
      createdFiles: string[],
      modifiedFiles: string[],
      strategy: ImplementOutput["strategy"],
    ): ImplementOutput => ({
      createdFiles,
      modifiedFiles,
      durationMs: Date.now() - startMs,
      strategy,
      trace,
    });
    const runModel = (): Promise<string> => {
      if (seams?.runPrompt) {
        // withTimeout compartido (limpia su timer al asentar: sin él el
        // proceso quedaba vivo hasta el fusible tras cada consume con seams).
        return withTimeout(
          seams.runPrompt({ strictSecondPass: false }),
          IMPLEMENT_LLM_TIMEOUT_MS,
          "implement seams.runPrompt",
        );
      }
      // Sin techo fijo: generateMinimalPatch lleva su propio watchdog por
      // progreso (idle 180s / absoluto 1h); un withTimeout acá mataría
      // turnos sanos de implementaciones grandes.
      return this.generateMinimalPatch(input);
    };

    // SDK + git verdicts (seams override the SDK check in tests; the git
    // check stays real: tmp dirs carrying package.json read as repos).
    const hasSdk = seams?.hasSdk ?? (await detectOpencodeSdk());
    const isGitRepo = (() => {
      try {
        return (
          fs.existsSync(path.join(worktreePath, ".git")) ||
          fs.existsSync(path.join(worktreePath, "package.json"))
        );
      } catch {
        return false;
      }
    })();

    if (!hasSdk) {
      pushTrace(
        "no-sdk",
        "LLM skipped: opencode SDK unavailable, so no model call was possible; job stays stopped in Building.",
      );
      return finish([], [], "llm");
    }
    if (!isGitRepo) {
      pushTrace(
        "no-git",
        "LLM skipped: worktree is not a git repo and has no package.json, so change detection has no baseline; job stays stopped in Building.",
      );
      return finish([], [], "llm");
    }

    try {
      // Flujo simple: UN solo turno LLM, sin reintentos. Si no toca
      // archivos, se registra y se devuelve vacío para que el service deje
      // el job parado en Building (sin Triage, sin fallback fantasma).
      const firstText = await runModel();
      const firstFiles = getFilteredCreatedFiles(worktreePath, startSnapshotMs, input.prompt);
      if (firstFiles.length > IMPLEMENT_MAX_FILES_MINIMAL) {
        rollbackIfExceeds(worktreePath, firstFiles, IMPLEMENT_MAX_FILES_MINIMAL);
        pushTrace(
          "rollback",
          `Model touched ${firstFiles.length} files (minimal limit ${IMPLEMENT_MAX_FILES_MINIMAL}); markers reverted, job stays stopped in Building.`,
          firstText,
        );
        return finish([], [], "llm");
      }
      if (firstFiles.length > 0) {
        pushTrace(
          "llm-ok",
          `Model edited ${firstFiles.length} file(s) via tools: ${firstFiles.slice(0, 5).join(", ")}.`,
          firstText,
        );
        return finish(firstFiles, firstFiles, "llm");
      }
      if (firstText.trim().length === 0) {
        pushTrace(
          "llm-no-tools",
          "Model answer came back empty (no text, zero tool writes); job stays stopped in Building.",
        );
        return finish([], [], "llm");
      }
      pushTrace(
        "llm-no-tools",
        "Model answer held prose with zero tool writes, so nothing changed on disk; job stays stopped in Building (no second pass).",
        firstText,
      );
      return finish([], [], "llm");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        const afterTry = getFilteredCreatedFiles(worktreePath, startSnapshotMs, input.prompt);
        if (afterTry.length > IMPLEMENT_MAX_FILES_MINIMAL) {
          rollbackIfExceeds(worktreePath, afterTry, IMPLEMENT_MAX_FILES_MINIMAL);
        }
      } catch {}
      if (msg.toLowerCase().includes("timeout")) {
        pushTrace(
          "timeout",
          `Model call timed out (${msg.slice(0, 120)}); job stays stopped in Building.`,
        );
      } else {
        pushTrace(
          "fallback",
          `Model call failed (${msg.slice(0, 160)}); job stays stopped in Building.`,
        );
      }
      return finish([], [], "llm");
    }
  }

  /**
   * Bounded fallback runner shared by every consume path. Creates ONLY the
   * exact NEW target the prompt requests; a modify-existing request without
   * applicable text is refused honest (no disk write) so the caller routes
   * to Triage with the reason. Emits exactly one fallback-branch trace event.
   */
  /**
   * Try to generate minimal patch via opencode efímero con tools.
   * Usa OpencodeServerManager.ensureClient() + session.create + prompt con tools read/write/edit/bash/glob/grep.
   * Retorna texto LLM. Flujo simple: UN solo intento por llamada, sin
   * reenvíos (el segundo parámetro legacy se ignora).
   */
  async generateMinimalPatch(
    input: ImplementInput | WorkItem,
    _opts?: { strictSecondPass?: boolean },
  ): Promise<string> {
    const worktreePath =
      (input as ImplementInput).worktreePath ??
      (input as WorkItem).worktree ??
      "";
    const directory = path.resolve(worktreePath);
    const hasSdk = await detectOpencodeSdk();
    if (!hasSdk) throw new Error("SDK no disponible");

    // Usar OpencodeServerManager efímero (20274) — Warp Gao: dueño único
    // Turno con config fresca: singleton si sigue vigente; server scopeado
    // recién nacido si la config de agentes cambió (fix PLATANO fuera del engine).
    let closeTurn: () => void = () => {};
    let client: unknown;
    try {
      const turn = await ensureAgentTurnClient();
      client = turn.client;
      closeTurn = turn.close;
    } catch (e) {
      // Fallback a getClient si ensure falla pero hay cliente existente
      const existing = opencodeServerManager.getClient() as unknown;
      if (existing) client = existing;
      else throw e;
    }

    // Turno único de datos: las reglas viven en el system prompt del espejo
    // (factory/agents/implement/agent.md), el turno lleva solo datos + cierre.
    // Sin strict second pass: siempre el prompt base.
    const promptText = buildImplementPrompt(input as ImplementInput);
    const typedClient = client as {
      session: {
        create: (opts: unknown) => Promise<unknown>;
        prompt?: (opts: unknown, ...rest: unknown[]) => Promise<unknown>;
        promptAsync?: (opts: unknown) => Promise<unknown>;
      };
    };
    const inputId = (input as { id: string }).id;
    const title = `Implement ${inputId}`;

    // Ola 16: create extraído a closure byte a byte (título, directorio,
    // doble forma path/body y extracción de id intactos, incluido el `throw
    // e` original ante doble fallo: se relanza el error de la PRIMERA forma).
    // El fallo LANZA (antes el caller no lo veía: generateMinimalPatch
    // siempre resolvía); el catch de abajo lo convierte al MISMO "" de antes
    // (el caller aplica su fallback actual, byte a byte).
    const createImplementSession = async (): Promise<string> => {
      let sessionId: string | undefined;
      try {
        const res: unknown = await withTimeout(
          (typedClient.session.create as (o: unknown) => Promise<unknown>).call(typedClient.session, {
            title,
            directory,
            // Identidad de fase (ver sessionAgentArgs): cae al shape plano si el server la rechaza.
            ...sessionAgentArgs("implement"),
          }),
          5000,
          "implement session.create",
        );
        const maybeData =
          res !== null && typeof res === "object" && "data" in (res as Record<string, unknown>)
            ? (res as Record<string, unknown>).data
            : res;
        const dataObj = maybeData as Record<string, unknown> | string | null | undefined;
        if (typeof dataObj === "string" && (dataObj as string).startsWith("ses_")) sessionId = dataObj as string;
        else if (dataObj && typeof dataObj === "object") {
          const o = dataObj as Record<string, unknown>;
          const cand =
            (typeof o.id === "string" ? o.id : undefined) ??
            (typeof o.sessionID === "string" ? o.sessionID : undefined) ??
            (typeof o.sessionId === "string" ? o.sessionId : undefined);
          if (cand) sessionId = cand;
        }
        if (!sessionId) throw new Error("no sessionId");
      } catch (e) {
        try {
          const res2: unknown = await withTimeout(
            (typedClient.session.create as (o: unknown) => Promise<unknown>).call(typedClient.session, {
              body: { title, directory },
            }),
            5000,
            "implement session.create body",
          );
          const maybeData2 =
            res2 !== null && typeof res2 === "object" && "data" in (res2 as Record<string, unknown>)
              ? (res2 as Record<string, unknown>).data
              : res2;
          const dataObj2 = maybeData2 as Record<string, unknown> | string | null | undefined;
          if (typeof dataObj2 === "string" && (dataObj2 as string).startsWith("ses_")) sessionId = dataObj2 as string;
          else if (dataObj2 && typeof dataObj2 === "object") {
            const o2 = dataObj2 as Record<string, unknown>;
            const cand2 =
              (typeof o2.id === "string" ? o2.id : undefined) ??
              (typeof o2.sessionID === "string" ? o2.sessionID : undefined);
            if (cand2) sessionId = cand2;
          }
          if (!sessionId) throw new Error("no sessionId fallback");
        } catch {
          throw e;
        }
      }
      if (!sessionId) throw new Error("no sessionId");
      return sessionId;
    };

    const sessionAny = typedClient.session as unknown as Record<string, unknown>;
    const promptFn = sessionAny.prompt as
      | ((opts: unknown, ...rest: unknown[]) => Promise<unknown>)
      | undefined;
    const messagesFn = sessionAny.messages as
      | ((opts: unknown) => Promise<unknown>)
      | undefined;

    const modelRef = (input as { modelRef?: { providerID: string; modelID: string; variant?: string } }).modelRef;
    const selectedModel = modelRef && modelRef.providerID && modelRef.modelID
      ? { providerID: modelRef.providerID, modelID: modelRef.modelID }
      : effectiveBuilderDefaultModel();

    const extractText = (res: unknown): string | null => {
      try {
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
          if (Array.isArray(d.parts)) {
            const texts = (d.parts as unknown[]).map((p) => {
              if (p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string")
                return (p as Record<string, unknown>).text as string;
              if (typeof p === "string") return p;
              return "";
            }).filter(Boolean);
            if (texts.length > 0) return texts.join("\n");
          }
        }
        return null;
      } catch {
        return null;
      }
    };

    // Warp tools: read/write/edit/bash/glob/grep habilitados (Gao)
    const body = {
      model: selectedModel,
      tools: IMPLEMENT_TOOLS as unknown as Record<string, unknown>,
      // Identidad ejecutante del turno (el agent del create solo etiqueta).
      ...sessionAgentArgs("implement"),
      parts: [{ type: "text", text: promptText }],
    };

    // Ola 16: la escalera toma sid (no cierra sobre sessionId) y captura
    // lastErr SIN tragarlo (antes: `catch {}` → "" directo). El not-found se
    // RELANZA en promptWith para que el helper renueve la sesión UNA vez;
    // cualquier otro fallo devuelve "" como antes (el caller aplica su
    // fallback actual, byte a byte).
    // Timing por PROGRESO (no techo fijo): cada intento corre con watchdog
    // (poll 20s, idle 180s, absoluto 1h) sobre UNA forma plana SDK 1.18.18
    // (el {path,body} se dropea y hace 500 — ver reviewAgent); promptAsync
    // devolvía handle sin texto y se eliminó. Hasta 2 intentos salvo techo
    // absoluto (misma cota de intentos que la escalera anterior de 4 formas).
    const runImplementLadder = async (sid: string): Promise<{ raw: string; lastErr: unknown }> => {
      if (typeof promptFn !== "function") return { raw: "", lastErr: null };
      const flat = { sessionID: sid, ...body };
      const pollParts = async (): Promise<PromptProgressMetric | null> => {
        try {
          if (typeof messagesFn !== "function") return null;
          const res = await (
            messagesFn as (o: unknown) => Promise<unknown>
          ).call(typedClient.session, { sessionID: sid });
          const raw = (res !== null &&
          typeof res === "object" &&
          "data" in (res as Record<string, unknown>)
            ? (res as Record<string, unknown>).data
            : res) as unknown;
          if (!Array.isArray(raw)) return null;
          let parts = 0;
          let textLen = 0;
          raw.forEach((m) => {
            try {
              if (m === null || typeof m !== "object" || Array.isArray(m)) return;
              const rec = m as Record<string, unknown>;
              const info = rec.info as Record<string, unknown> | undefined;
              const role =
                info !== null && typeof info === "object" && typeof info.role === "string"
                  ? info.role
                  : rec.role;
              if (role !== "assistant") return;
              const list = Array.isArray(rec.parts) ? rec.parts : [];
              list.forEach((p) => {
                try {
                  if (p === null || typeof p !== "object" || Array.isArray(p)) return;
                  parts += 1;
                  const t = (p as Record<string, unknown>).text;
                  if (typeof t === "string") textLen += t.length;
                } catch {}
              });
            } catch {}
          });
          return { parts, textLen };
        } catch {
          return null;
        }
      };
      const invokeOnce = (): Promise<unknown> =>
        awaitPromptWithProgress({
          start: (signal) =>
            (promptFn as (a: unknown, b: unknown) => Promise<unknown>).call(
              typedClient.session,
              flat,
              { signal },
            ),
          poll: pollParts,
          label: "implement session.prompt",
        });
      // Flujo simple: UN solo intento, sin reenvíos. Timeout, rechazo o
      // respuesta vacía devuelven el fallo y el consume deja el job parado
      // en Building (sin segundo intento en la misma sesión).
      try {
        const res = await invokeOnce();
        // T4: uso real del servidor (skills/MCPs/contexto incluidos). La
        // medición nunca rompe la escalera.
        try {
          recordRealUsage(inputId, extractSessionUsage(res), sid);
        } catch {}
        const txt = extractText(res);
        if (txt) return { raw: txt, lastErr: null };
        return { raw: "", lastErr: new Error("empty response") };
      } catch (e) {
        return { raw: "", lastErr: e };
      }
    };

    // Ola 16: promptWith lleva el costo de Ola 15 ADENTRO (1 llamada lógica
    // = 1 conteo, ortogonal) y re-lanza not-found para renovación lazy.
    // jobId = `inputId` (ImplementInput.id o WorkItem.id, ya definido arriba).
    const promptWithImplementSession = async (sid: string): Promise<string> => {
      let out: { raw: string; lastErr: unknown };
      try {
        out = await promptInSessionWithCost(inputId, () => runImplementLadder(sid), promptText, selectedModel);
      } catch (e) {
        out = { raw: "", lastErr: e };
      }
      if (out.raw) return out.raw;
      if (isSessionNotFoundError(out.lastErr)) throw out.lastErr;
      return "";
    };

    try {
      // Flujo simple: resume la sesión implement de este job (renovación
      // lazy +1). Una sola llamada: ≤1 create y 1 prompt por llamada.
      return (
        await promptInAgentSession({
          jobId: inputId,
          role: "implement",
          create: createImplementSession,
          promptWith: promptWithImplementSession,
          expectAgent: "implement",
          getAgent: (sid: string) => readSessionAgent(typedClient.session, sid),
        })
      ).res;
    } catch {
      return "";
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
   * Fallback determinístico helper expuesto para tests.
   */
  fallbackMinimalChange(input: ImplementInput | WorkItem): string[] {
    return fallbackMinimalChange(input as ImplementInput);
  }
}

export const implementAgent = new ImplementAgent();
