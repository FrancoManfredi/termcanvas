/**
 * Ola 20 E2 — meta-test anti-loops (cierre formal de la Regla 7).
 * `npx tsx --test tests/no-unbounded-loops.test.ts` (offline, sin daemon).
 *
 * Diseño pragmático (según el plan §7.2): el test conoce los archivos del
 * daemon y exige que cada match de patrón-loop
 * (`retry|setInterval|setTimeout|while\s*\(|for\s*\(`) en esos archivos tenga
 * su entrada justificada en `docs/LOOPS.md` (vía `BOUNDED`, que cita la
 * constante real del código) o su exención documentada acá mismo
 * (`FOR_EXEMPT_FILES`, `RETRY_EXEMPT_TOKENS`, con el porqué).
 *
 * Garantías:
 * 1. Cobertura: match sin justificación cercana (±30 líneas) o sin exención
 *    → rojo ("registralo en docs/LOOPS.md"). Un reintento/intervalo nuevo sin
 *    registrar falla.
 * 2. Anti-drift: cada entrada `BOUNDED` exige que su `capText` siga en el
 *    fuente y que su `doc` siga en `docs/LOOPS.md`. Subir una cota sin
 *    actualizar el doc falla.
 * 3. Constantes: `CONSTANTS` verifica que los números del doc sigan iguales
 *    en el código (el doc cita valores, no deseos).
 * 4. Formas infinitas: `for(;;)` y `while(true)` prohibidos en todo el daemon.
 * 5. Archivos nuevos: los directorios del daemon se escanean completos (un
 *    `.ts` nuevo con loops falla hasta justificarlo); `interview/` tiene
 *    snapshot de archivos (fuera del path factory en vivo pero auditado).
 *
 * Calibración honesta: las entradas nacen de leer el código real (no al revés).
 * La prueba rojo→verde del propio desarrollo está en el resumen de la ola.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const LOOPS_MD = path.join(REPO, "docs", "LOOPS.md");

/** Ventana de proximidad entrada↔match (líneas). */
const WINDOW = 30;

// ── Alcance: qué es "el daemon" ─────────────────────────────────────────────

/** Directorios escaneados COMPLETOS (todo `.ts` no-test cuenta). */
const DAEMON_DIRS: readonly string[] = [
  "headless-runtime/factory",
  "headless-runtime/sessions",
  "headless-runtime/measure",
  "headless-runtime/notify",
  "headless-runtime/runner",
  "headless-runtime/cost",
  "headless-runtime/review",
  "headless-runtime/implement",
  "headless-runtime/foreman",
  "headless-runtime/spec",
  "headless-runtime/triage",
  "headless-runtime/workItem",
];

/** Archivos del daemon fuera de esos directorios (mismo runtime). */
const DAEMON_ROOT_FILES: readonly string[] = [
  "headless-runtime/opencodeServerManager.ts",
  "headless-runtime/notification-transport.ts",
  "headless-runtime/heartbeat.ts",
  "headless-runtime/lifecycle.ts",
  "headless-runtime/api-server.ts",
  "headless-runtime/interview/engine.ts",
  "headless-runtime/interview/tactics.ts",
  "headless-runtime/interview/harness/opencode.ts",
  "headless-runtime/interview/harness/codebuddy.ts",
  "headless-runtime/interview/brief.ts",
  "headless-runtime/interview/curation.ts",
];

function listTsFiles(dirRel: string): string[] {
  const abs = path.join(REPO, dirRel);
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      out.push(path.relative(REPO, full).split(path.sep).join("/"));
    }
  };
  walk(abs);
  return out.sort();
}

function daemonFiles(): string[] {
  const fromDirs = DAEMON_DIRS.flatMap((d) => listTsFiles(d));
  const all = [...fromDirs, ...DAEMON_ROOT_FILES].sort();
  for (const f of DAEMON_ROOT_FILES) {
    assert.ok(
      fs.existsSync(path.join(REPO, f)),
      `archivo del daemon listado pero inexistente (¿renombre?): ${f}`,
    );
  }
  return all;
}

// ── Entradas justificadas (cota real del código + fila del doc) ─────────────

interface Bounded {
  /** Archivo relativo al repo. */
  file: string;
  /** Qué patrón cubre: interval | timeout | while | for | retry. */
  kind: "interval" | "timeout" | "while" | "for" | "retry";
  /** Texto distintivo del sitio (cada ocurrencia radia cobertura ±WINDOW). */
  needle: string;
  /** Constante/evidencia que DEBE seguir en el fuente cerca del needle. */
  capText: string;
  /** Texto que DEBE seguir en docs/LOOPS.md (fila del inventario). */
  doc: string;
}

const BOUNDED: readonly Bounded[] = [
  // Intervalos fijos con cleanup (S03/S06/S07/L10).
  { file: "headless-runtime/api-server.ts", kind: "interval", needle: "rateLimitCleanupTimer = setInterval", capText: "60_000", doc: "rate-limit map" },
  { file: "headless-runtime/api-server.ts", kind: "interval", needle: "diskUsageTimer = setInterval", capText: "30_000", doc: "uso de disco" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "interval", needle: "const heartbeat = setInterval", capText: "15000", doc: "15000ms" },
  { file: "headless-runtime/heartbeat.ts", kind: "interval", needle: "this.timer = setInterval", capText: "DEFAULT_INTERVAL_MS", doc: "DEFAULT_INTERVAL_MS = 10000" },
  // while acotados (S12/S02/N01).
  { file: "headless-runtime/foreman/foreman.ts", kind: "while", needle: "pollForAssistantJson", capText: "Date.now() - start < timeoutMs", doc: "pollForAssistantJson" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "while", needle: "maxAttempts = 3", capText: "attempts < maxAttempts", doc: "maxAttempts = 3" },
  { file: "headless-runtime/notify/notifications.ts", kind: "while", needle: "NOTIFICATIONS_MAX", capText: "store.length > NOTIFICATIONS_MAX", doc: "NOTIFICATIONS_MAX = 100" },
  // Wave 14 I02 (Track B): mock evidence ring, oldest evicted first.
  { file: "headless-runtime/factory/integrations/mockAdapter.ts", kind: "while", needle: "INTEGRATION_MOCK_MAX", capText: "posts.length > INTEGRATION_MOCK_MAX", doc: "INTEGRATION_MOCK_MAX = 100" },
  // Wave 14 A01 (Track A owner of the file; entry lives here per T04): the
  // single automation ticker, one setInterval plus clearInterval, fixed
  // period from config (tickMs 0 means fully off).
  { file: "headless-runtime/factory/automations/automationService.ts", kind: "interval", needle: "tickerHandle = setInterval", capText: "clearInterval", doc: "AUTOMATION_TICK" },
  // Timeouts factoryServer (L01+L02/S16/S03). S14 (worker-kick) quedó
  // ELIMINADO: el worker legacy ya no existe en el engine.
  { file: "headless-runtime/factory/factoryServer.ts", kind: "timeout", needle: "ctrl.abort(), 800", capText: "800", doc: "800ms" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "retry", needle: "intake session.create", capText: "withTransportRetry", doc: "transporte único (agentTransport)" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "timeout", needle: "let timer: ReturnType<typeof setTimeout> | undefined;", capText: "Promise.race", doc: "retry ≤ 1" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "timeout", needle: "ctrl.abort(), 1000", capText: "1000", doc: "1000ms (abort control)" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "timeout", needle: "abortTimer = setTimeout", capText: "12000", doc: "12000ms" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "timeout", needle: "closeTimer = setTimeout", capText: "300", doc: "cierran en 300ms" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "timeout", needle: "finiteCloseTimer = setTimeout", capText: "4000", doc: "finiteCloseTimer` 4000ms" },
  { file: "headless-runtime/factory/factoryServer.ts", kind: "timeout", needle: "controller.abort(), timeoutMs", capText: "timeoutMs", doc: "aborts de fetch" },
  // Timeouts foreman (sonda 800ms, abort 2s, sleep 500ms). El helper
  // withTimeout local se eliminó (transporte único agentTransport, fila L11).
  { file: "headless-runtime/foreman/foreman.ts", kind: "timeout", needle: "ctrl.abort(), 800", capText: "800", doc: "800ms" },
  { file: "headless-runtime/foreman/foreman.ts", kind: "timeout", needle: "ctrl.abort(), 2000", capText: "2000", doc: "abort 2000ms" },
  { file: "headless-runtime/foreman/foreman.ts", kind: "timeout", needle: "setTimeout(r, 500)", capText: "500", doc: "sleep 500ms" },
  // Timeouts con kill / races por agente (P02/P03/L04/L05/P04). El
  // withTimeout local de implementAgent se eliminó (fugaba su timer 1h y
  // colgaba el proceso; ahora usa el compartido que limpia al asentar).
  { file: "headless-runtime/implement/verification.ts", kind: "timeout", needle: "const timer = setTimeout(() => {", capText: "SIGTERM", doc: "SIGTERM" },
  { file: "headless-runtime/implement/implementService.ts", kind: "timeout", needle: "setTimeout(r, 8000)", capText: "8000", doc: "8000ms (ventana de cancel F04)" },
  { file: "headless-runtime/interview/harness/codebuddy.ts", kind: "timeout", needle: "killTimer = setTimeout", capText: "SIGKILL", doc: "kill de seguridad" },
  { file: "headless-runtime/interview/harness/opencode.ts", kind: "timeout", needle: "setTimeout(r, 400 * (attempt + 1))", capText: "SERVER_START_RETRIES", doc: "SERVER_START_RETRIES = 2" },
  { file: "headless-runtime/opencodeServerManager.ts", kind: "timeout", needle: "cold start", capText: "800", doc: "cold-start 800ms" },
  { file: "headless-runtime/opencodeServerManager.ts", kind: "timeout", needle: "HEALTH_TIMEOUT_MS", capText: "HEALTH_TIMEOUT_MS", doc: "HEALTH_TIMEOUT_MS = 3000" },
  { file: "headless-runtime/opencodeServerManager.ts", kind: "timeout", needle: "setTimeout(res, 300)", capText: "300", doc: "300ms entre intentos" },
  { file: "headless-runtime/opencodeServerManager.ts", kind: "timeout", needle: "setTimeout(r, 400 * (attempt + 1))", capText: "SERVER_START_RETRIES", doc: "backoff `400ms" },
  // Spawner propio (sin SDK): arranque con UN solo timeout de SERVER_START_TIMEOUT_MS, nunca re-armado.
  { file: "headless-runtime/opencodeServerManager.ts", kind: "timeout", needle: "const timer = setTimeout(() =>", capText: "SERVER_START_TIMEOUT_MS", doc: "spawner propio: un solo timeout de arranque" },
  { file: "headless-runtime/lifecycle.ts", kind: "timeout", needle: "createPersistenceController", capText: "delayMs = 500", doc: "delayMs = 500" },
  { file: "headless-runtime/notification-transport.ts", kind: "timeout", needle: "this.retryDelaysMs[attempt]", capText: "this.retryDelaysMs.length", doc: "DEFAULT_RETRY_DELAYS_MS" },
  { file: "headless-runtime/runner/runnerExecutor.ts", kind: "timeout", needle: "DOCKER_PROBE_TIMEOUT_MS + 500", capText: "SIGKILL", doc: "SIGKILL" },
  { file: "headless-runtime/runner/runnerExecutor.ts", kind: "timeout", needle: "timeoutMs + 500", capText: "SIGTERM", doc: "SIGTERM" },
  // Reintentos mecánicos (L01/L06/L07/L08/L09).
  { file: "headless-runtime/factory/factoryServer.ts", kind: "retry", needle: "intake session.create body", capText: "withTransportRetry", doc: "transporte único (agentTransport)" },
  { file: "headless-runtime/notification-transport.ts", kind: "retry", needle: "retryDelaysMs", capText: "DEFAULT_RETRY_DELAYS_MS", doc: "≤ 4 envíos" },
  { file: "headless-runtime/opencodeServerManager.ts", kind: "retry", needle: "SERVER_START_RETRIES", capText: "SERVER_START_TIMEOUT_MS", doc: "SERVER_START_RETRIES = 3" },
  { file: "headless-runtime/opencodeServerManager.ts", kind: "retry", needle: "HEALTH_RETRIES", capText: "HEALTH_TIMEOUT_MS", doc: "HEALTH_RETRIES = 3" },
  { file: "headless-runtime/interview/harness/opencode.ts", kind: "retry", needle: "SERVER_START_RETRIES", capText: "SERVER_START_TIMEOUT_MS", doc: "SERVER_START_RETRIES = 2" },
  { file: "headless-runtime/interview/engine.ts", kind: "retry", needle: "SERVER_START_RETRIES", capText: "SERVER_START_TIMEOUT_MS", doc: "SERVER_START_RETRIES = 2" },
  { file: "headless-runtime/interview/engine.ts", kind: "retry", needle: "MAX_STRUCTURED_RETRIES", capText: "attempt <= MAX_STRUCTURED_RETRIES", doc: "MAX_STRUCTURED_RETRIES = 2" },
  { file: "headless-runtime/review/reviewAgent.ts", kind: "retry", needle: "reviewAttempt", capText: "Math.max(1, input.reviewAttempt)", doc: "clamp inferior (sin techo)" },
  // Wrappers withTimeoutRetry: 1 reintento ante fallo retryable (fila L11).
  // Needle = la firma (el match vive 3-6 líneas debajo, dentro de ±WINDOW).
  { file: "headless-runtime/factory/factoryServer.ts", kind: "retry", needle: "Robust port binding", capText: "maxAttempts = 3", doc: "maxAttempts = 3" },
  // Transporte único agentTransport (doctrina no-resend, fila L11-NEW del doc):
  // cada agente delega el intento en el helper compartido — cero
  // `withTimeoutRetry` locales con reenvío ante timeout. Needle = el uso del
  // helper (el capText vive en la misma llamada, dentro de ±WINDOW).
  { file: "headless-runtime/foreman/foreman.ts", kind: "retry", needle: "attemptJsonPromptOnce", capText: "isModelSwitchableError", doc: "transporte único (agentTransport)" },
  { file: "headless-runtime/spec/specAgent.ts", kind: "retry", needle: "attemptPromptOnce", capText: "preferKey: \"acceptanceCriteria\"", doc: "transporte único (agentTransport)" },
  { file: "headless-runtime/triage/triageAgent.ts", kind: "retry", needle: "attemptJsonPromptOnce", capText: "preferKey: \"decision\"", doc: "transporte único (agentTransport)" },
  { file: "headless-runtime/review/reviewAgent.ts", kind: "retry", needle: "attemptJsonPromptOnce", capText: "preferKey: \"verdict\"", doc: "transporte único (agentTransport)" },
  { file: "headless-runtime/measure/scorerEngine.ts", kind: "retry", needle: "attemptPromptOnce", capText: "preferKey: \"label\"", doc: "transporte único (agentTransport)" },
  { file: "headless-runtime/measure/improvementEngine.ts", kind: "retry", needle: "attemptPromptOnce", capText: "preferKey: \"pattern\"", doc: "transporte único (agentTransport)" },
  // withTimeout por agente: el único vive en el módulo único
  // headless-runtime/llm/agentTransport.ts (fuera del alcance del scan:
  // `llm/` no está en DAEMON_DIRS). Fila L04 del doc.
  { file: "headless-runtime/interview/tactics.ts", kind: "timeout", needle: "SESSION_CREATE_TIMEOUT_MS", capText: "60_000", doc: "SESSION_CREATE_TIMEOUT_MS = 60000" },
  // F1 L-IN-01 (T3 wiring; T1/T2 effects read-only): the caller-held intake
  // dedupe FIFO (oldest evicted first; every pass shrinks length).
  { file: "headless-runtime/factory/integrations/integrationService.ts", kind: "while", needle: "seenIntakeEventIds", capText: "WEBHOOK_DEDUPE_MAX", doc: "WEBHOOK_DEDUPE_MAX = 500" },
  // F1 L-IN-02 (T3 wiring; liveAdapter read-only): the single-shot HTTP
  // timeout per post-back attempt (timer cleared in finally, never re-armed).
  { file: "headless-runtime/factory/integrations/liveAdapter.ts", kind: "timeout", needle: "timer = setTimeout", capText: "timeoutMs", doc: "LIVE_ADAPTER_DEFAULT_TIMEOUT_MS = 15000" },
  // F1 L-IN-02 (T3 wiring; liveAdapter read-only): the capped attempt loop
  // (1 try + 2 attempts, then an honest failed event — no sleeps/backoff).
  { file: "headless-runtime/factory/integrations/liveAdapter.ts", kind: "for", needle: "i < POSTBACK_MAX_ATTEMPTS", capText: "POSTBACK_MAX_ATTEMPTS", doc: "POSTBACK_MAX_ATTEMPTS = 3" },
  // PTY destroy grace (LOOPS S19): one-shot 500ms close fallback, never re-armed.
  { file: "headless-runtime/api-server.ts", kind: "timeout", needle: "Grace window", capText: "}, 500)", doc: "PTY destroy grace 500ms" },
  // Flujo simple (L12/P05 eliminados): implement a un solo turno, sin strict
  // second pass, sin lectura tardía ni rescan. Solo el watchdog por progreso.
  { file: "headless-runtime/implement/implementAgent.ts", kind: "timeout", needle: "setTimeout(tick, intervalMs)", capText: "idle timeout", doc: "watchdog por progreso" },
  // F3-T3 (wiring +0, 2026-09-05): no new daemon loop/attempt/ring/interval.
  // Decision flows reuse existing polls (15s/5s + on-demand clicks); the new
  // definitionValidate decision checks are structural `for` over capped
  // finite listings in an already-exempt file (see LOOPS.md F3-T3 +0-note).
  // No BOUNDED / CONSTANTS / exemption entry needed.
  // E1-A pre-verify late-flush rescan (H-013 extended to first verify):
  // bounded `for` + short sleeps, only on empty/H-012 shape (see LOOPS P05).
  // Rondas de sesión por nodo de loop (VIEW AGENT por ronda, LOOPS G07):
  // `for...of` sobre el historial acotado (las viejas se descartan).
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const entry of rounds)", capText: "NODE_SESSION_ROUNDS_MAX", doc: "NODE_SESSION_ROUNDS_MAX = 50" },
  // Auditoría 2026-09-16: los 9 `for` restantes de engineBridge con entrada
  // individual (E01-E09 del doc) + su timer de auto-resume (E10). Cada uno
  // itera una colección finita (mapa, array acotado, timeline) con evidencia
  // de finitud chequeada contra el fuente.
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const [itemId, runId] of Object.entries(raw))", capText: "hydrated = true", doc: "hydrateMap — mapa finito (engine-map.json) + guard hydrated" },
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const entry of findings)", capText: "Array.isArray(findings)", doc: "renderFindingsText — array findings finito" },
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const step of steps)", capText: "steps: Array<Record<string, unknown>>", doc: "renderVerifyLog — steps finitos (verify-runner)" },
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const n of nodes)", capText: "Object.keys(nodeSessions).length < 50", doc: "syncEngineRunFromRun — cap 50 por mapa + break" },
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const [key, spec] of Object.entries(def.inputs))", capText: "def.inputs", doc: "runInputsForWorkflowDef — def.inputs finito" },
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const entry of timeline)", capText: "Array.isArray(timeline)", doc: "countAutoResumes — timeline finito" },
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (let i = timeline.length - 1; i >= 0; i--)", capText: "Array.isArray(timeline)", doc: "interruptionMs — barrido reverso del timeline" },
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const item of workItemStore.list())", capText: "AUTO_RESUME_MAX_ATTEMPTS", doc: "autoResume candidatos — workItemStore.list() finito + AUTO_RESUME_MAX_ATTEMPTS = 3" },
  { file: "headless-runtime/factory/engineBridge.ts", kind: "for", needle: "for (const candidate of candidates.slice(0, autoResumeMaxPerBoot()))", capText: "AUTO_RESUME_MAX_ATTEMPTS", doc: "autoResume resume — slice(0, autoResumeMaxPerBoot())" },
  // E10: stagger de auto-resume one-shot (un disparo, sin re-arme), kill
  // switch TERMCANVAS_FACTORY_NO_AUTORESUME=1.
  { file: "headless-runtime/factory/engineBridge.ts", kind: "timeout", needle: "const timer = setTimeout", capText: "delayMs = 3000", doc: "autoResumeParkedEngineJobs delayMs = 3000" },
  // RS01: restart del runner con backoff acotado por maxRestarts (default
  // RUNNER_MAX_RESTARTS = 5), timer con clearTimeout en stop + unref.
  { file: "headless-runtime/factory/github/runnerSupervisor.ts", kind: "timeout", needle: "this.timer = setTimeout", capText: "this.deps.maxRestarts", doc: "RUNNER_MAX_RESTARTS = 5" },
  // Option A (publicación tras el revisor externo, LOOPS R01): sleep
  // one-shot entre polls (nunca re-armado) + intento acotado del waiter.
  { file: "headless-runtime/review/botReview.ts", kind: "timeout", needle: "setTimeout(resolve, ms)", capText: "BOT_REVIEW_POLL_MS", doc: "BOT_REVIEW_POLL_MS = 60000" },
  { file: "headless-runtime/review/botReview.ts", kind: "for", needle: "attempt < maxPolls", capText: "BOT_REVIEW_MAX_POLLS", doc: "BOT_REVIEW_MAX_POLLS = 20" },
];

/**
 * Archivos cuyos `for(` están TODOS auditados como iteración acotada sobre
 * colecciones finitas (Exención 1 del doc: arrays, readdir, rangos cerrados,
 * líneas, entries de Map — terminación estructural, sin `for(;;)`).
 * Un `for(` en un archivo NO listado acá y sin entrada BOUNDED = rojo.
 */
const FOR_EXEMPT_FILES: readonly string[] = [
  "headless-runtime/factory/factoryServer.ts",
  "headless-runtime/factory/agentLoader.ts",
  "headless-runtime/factory/definitionValidate.ts",
  "headless-runtime/implement/verification.ts",
  "headless-runtime/implement/minimalChange.ts",
  "headless-runtime/foreman/foreman.ts",
  "headless-runtime/measure/scorerEngine.ts",
  "headless-runtime/measure/sampler.ts",
  "headless-runtime/measure/benchmarkEngine.ts",
  "headless-runtime/measure/improvementEngine.ts",
  "headless-runtime/measure/scorerLoader.ts",
  "headless-runtime/notify/notifications.ts",
  "headless-runtime/notification-transport.ts",
  "headless-runtime/review/reviewService.ts",
  "headless-runtime/review/reverifyAllowlist.ts",
  "headless-runtime/review/reviewModelSelector.ts",
  "headless-runtime/runner/runnerConfig.ts",
  "headless-runtime/runner/runnerExecutor.ts",
  "headless-runtime/spec/specFlow.ts",
  "headless-runtime/spec/specPrompt.ts",
  "headless-runtime/triage/triageFlow.ts",
  "headless-runtime/workItem/workItemDisk.ts",
  "headless-runtime/workItem/workItemStore.ts",
  "headless-runtime/workItem/resultStore.ts",
  "headless-runtime/factory/routing/routeTable.ts",
  "headless-runtime/api-server.ts",
  "headless-runtime/foreman/foremanLog.ts",
  "headless-runtime/event-bus.ts",
  "headless-runtime/project-store.ts",
  "headless-runtime/artifact-collector.ts",
  "headless-runtime/index.ts",
  "headless-runtime/interview/brief.ts",
  "headless-runtime/interview/curation.ts",
  "headless-runtime/interview/engine.ts",
  "headless-runtime/interview/tactics.ts",
  "headless-runtime/interview/harness/opencode.ts",
  "headless-runtime/sessions/agentSessions.ts",
  "headless-runtime/opencodeServerManager.ts",
  // jobView (pure projection): single `for...of` over ISOLATION_TEXT_KEYS
  // (6 fixed keys, sync trim+slice only, no awaits/timers/retries).
  "headless-runtime/workItem/jobView.ts",
  // gitHubPr PR-text enrichment: bounded reverse walks over the finite job
  // timeline (extract-with-break, same pattern as reviewService).
  "headless-runtime/factory/isolation/gitHubPr.ts",
  // F1 (T3 wiring; files owned read-only by T1/T2): bounded structural
  // iteration only (fixed key lists, finite validated objects/timelines;
  // the capped attempt loop lives in L-IN-02, not here).
  "headless-runtime/factory/integrations/integrationTypes.ts",
  "headless-runtime/factory/integrations/liveAdapter.ts",
  "headless-runtime/factory/jobs/jobCreate.ts",
  // Iteración finita auditada 2026-09-10 (Exención 1): `for` sobre líneas de
  // texto (splitAgentRaw), barrido reverso de timeline finito con break,
  // listas/mapas/readdir finitos y líneas de `git status` + lista acotada
  // (slice 0,50). Ninguno re-programa, acumula ni espera: terminación
  // estructural por índice/iterador finito.
  "headless-runtime/factory/agents/agentFileRoutes.ts",
  "headless-runtime/factory/jobs/jobService.ts",
  "headless-runtime/factory/opencodeAgentSync.ts",
  "headless-runtime/review/reviewDiff.ts",
  // Alta de agentes + hooks (auditoría 2026-09-10): `for...of` sobre
  // dir entries, findings acotados (slice 0,20), lista de hooks
  // descubierta y tokens de frontmatter — todo finito, sin re-arme.
  "headless-runtime/factory/agents/agentHooks.ts",
  "headless-runtime/runner/toolPolicy.ts",
  // Auditoría 2026-09-16 (Exención 1): iteración estructural sobre
  // colecciones finitas — entries de mapas validados (mcpFileRoutes,
  // runnersService), líneas de texto (isolationStore), listado de jobs en
  // memoria (mergeReconcile, workerActivity).
  "headless-runtime/factory/mcps/mcpFileRoutes.ts",
  "headless-runtime/factory/github/runnersService.ts",
  "headless-runtime/factory/isolation/isolationStore.ts",
  "headless-runtime/factory/isolation/mergeReconcile.ts",
  "headless-runtime/workItem/workerActivity.ts",
];

/**
 * Tokens que eximen líneas `retry` que NO son loops (Exención 3 del doc):
 * rutas/handlers single-shot, guards puros, header HTTP, campo de config,
 * y comentarios/logs que describen una política ya inventariada (cada token
 * es un fragmento distintivo, no una palabra suelta).
 */
const RETRY_EXEMPT_TOKENS: readonly string[] = [
  "verify-retry",
  "verifyRetry",
  "VerifyRetry",
  "verify retry",
  "retry-review",
  "review-retry",
  "retry-analysis",
  "retryAnalysis",
  "RetryAnalysis",
  "RETRY_ANALYSIS",
  "retryReview",
  "RetryReview",
  "Retry-After",
  "retryAfter",
  "/review/retry",
  "human retry",
  "human-retry",
  "maxRetries",
  "retry futuro",
  "checkRetryReviewGuards",
  "checkVerifyRetryGuards",
  "parseVerifyRetryPath",
  // P4c: etiquetas de intento humano en comentarios (FU-3 A-retry), no loops.
  "A-retry",
  '"retry"',
  "'retry'",
  "retry 1 vez",
  "1 retry",
  "timeout + retry",
  "20s+retry",
  "ms+retry",
  "retry o fallback",
  "retry, etc.",
  // F1 L-IN-02 (T3 wiring): comments describing the capped post-back policy
  // (bounded attempts, no free re-attempt — see LOOPS L-IN-02).
  "retry cap 3",
  "adapter with retry",
  // Repair-retry policy comments (ONE repair attempt per consume — a
  // straight line, not a loop; registered per the doc's Exención 3).
  "repair retry",
  "Repair retry",
  // Auditoría 2026-09-16 (Exención 3): acciones del panel y guards
  // retirados/mensajes que nombran "retry" sin ser loops.
  "accept/retry",
  "Retry review",
  "review retry legacy",
  "VERIFY-RETRY",
];

/** Constantes: el número del doc debe seguir igual en el código. */
const CONSTANTS: readonly Array<{ file: string; code: string; doc: string }> = [
  { file: "shared/types/review.ts", code: "MAX_REVIEW_ROUNDS = 1", doc: "MAX_REVIEW_ROUNDS = 1" },
  { file: "shared/types/review.ts", code: "REVERIFY_MAX_COMMANDS = 20", doc: "REVERIFY_MAX_COMMANDS = 20" },
  { file: "shared/types/review.ts", code: "REVERIFY_MAX_COMMAND_LEN = 500", doc: "REVERIFY_MAX_COMMAND_LEN = 500" },
  { file: "shared/types/benchmark.ts", code: "BENCHMARK_MAX_TRIALS = 50", doc: "BENCHMARK_MAX_TRIALS = 50" },
  { file: "shared/types/benchmark.ts", code: "BENCHMARK_TASK_MAX_FILES = 5", doc: "BENCHMARK_TASK_MAX_FILES = 5" },
  { file: "shared/types/scorer.ts", code: "SCORER_MAX_LABELS = 10", doc: "SCORER_MAX_LABELS = 10" },
  { file: "shared/types/implement.ts", code: "IMPLEMENT_VERIFY_TIMEOUT_MS = 120_000", doc: "IMPLEMENT_VERIFY_TIMEOUT_MS = 120000" },
  { file: "shared/types/implement.ts", code: "IMPLEMENT_LLM_TIMEOUT_MS = 3_600_000", doc: "IMPLEMENT_LLM_TIMEOUT_MS = 3600000" },
  { file: "shared/types/implement.ts", code: "IMPLEMENT_PROGRESS_IDLE_MS = 180_000", doc: "IMPLEMENT_PROGRESS_IDLE_MS = 180000" },
  { file: "shared/types/implement.ts", code: "IMPLEMENT_PROGRESS_POLL_MS = 20_000", doc: "IMPLEMENT_PROGRESS_POLL_MS = 20000" },
  { file: "shared/types/implement.ts", code: "IMPLEMENT_MAX_CREATED_FILES = 50", doc: "IMPLEMENT_MAX_CREATED_FILES = 50" },
  { file: "shared/types/improvement.ts", code: "IMPROVEMENT_MAX_CONTENT = 16384", doc: "IMPROVEMENT_MAX_CONTENT = 16384" },
  { file: "headless-runtime/measure/improvementHttp.ts", code: "RETRY_ANALYSIS_MAX = 1", doc: "RETRY_ANALYSIS_MAX = 1" },
  { file: "headless-runtime/notify/notifications.ts", code: "NOTIFICATIONS_MAX = 100", doc: "NOTIFICATIONS_MAX = 100" },
  { file: "headless-runtime/runner/runnerExecutor.ts", code: "DOCKER_PROBE_TTL_MS = 60_000", doc: "DOCKER_PROBE_TTL_MS = 60000" },
  { file: "headless-runtime/runner/runnerExecutor.ts", code: "DOCKER_PROBE_MAX_ATTEMPTS = 1", doc: "DOCKER_PROBE_MAX_ATTEMPTS = 1" },
  { file: "headless-runtime/runner/runnerExecutor.ts", code: "DOCKER_PROBE_TIMEOUT_MS = 5000", doc: "DOCKER_PROBE_TIMEOUT_MS = 5000" },
  { file: "headless-runtime/factory/definitionValidate.ts", code: "BENCHMARKS_MAX_FILES = 50", doc: "BENCHMARKS_MAX_FILES = 50" },
  // Wave 14 A/I bounds (T01 contracts; effects in T02/T03; LOOPS rows A01/A05/A06/I02/I03).
  { file: "headless-runtime/factory/automations/automationTypes.ts", code: "AUTOMATION_TICK_DEFAULT_MS = 30000", doc: "AUTOMATION_TICK_DEFAULT_MS = 30000" },
  { file: "headless-runtime/factory/automations/automationTypes.ts", code: "AUTOMATIONS_MAX_TRIGGERS = 20", doc: "AUTOMATIONS_MAX_TRIGGERS = 20" },
  { file: "headless-runtime/factory/automations/automationTypes.ts", code: "AUTOMATIONS_MAX_ENTRIES = 200", doc: "AUTOMATIONS_MAX_ENTRIES = 200" },
  { file: "headless-runtime/factory/integrations/integrationTypes.ts", code: "INTEGRATION_MOCK_MAX = 100", doc: "INTEGRATION_MOCK_MAX = 100" },
  { file: "headless-runtime/factory/integrations/integrationTypes.ts", code: "INTEGRATION_TITLE_MAX = 200", doc: "INTEGRATION_TITLE_MAX = 200" },
  { file: "headless-runtime/factory/integrations/integrationTypes.ts", code: "INTEGRATION_BODY_MAX = 2000", doc: "INTEGRATION_BODY_MAX = 2000" },
  // F1 live-intake caps (T3 wiring; contracts land in T1, effects in T2).
  { file: "headless-runtime/factory/integrations/integrationTypes.ts", code: "WEBHOOK_DEDUPE_MAX = 500", doc: "WEBHOOK_DEDUPE_MAX = 500" },
  { file: "headless-runtime/factory/integrations/integrationTypes.ts", code: "POSTBACK_MAX_ATTEMPTS = 3", doc: "POSTBACK_MAX_ATTEMPTS = 3" },
  { file: "headless-runtime/factory/integrations/liveAdapter.ts", code: "LIVE_ADAPTER_DEFAULT_TIMEOUT_MS = 15000", doc: "LIVE_ADAPTER_DEFAULT_TIMEOUT_MS = 15000" },
  { file: "headless-runtime/cost/costTracker.ts", code: "COST_TRACKER_MAX_ENTRIES = 10_000", doc: "COST_TRACKER_MAX_ENTRIES = 10000" },
  { file: "headless-runtime/api-server.ts", code: "MAX_SSE_CONNECTIONS = 50", doc: "MAX_SSE_CONNECTIONS = 50" },
  { file: "headless-runtime/notification-transport.ts", code: "DEFAULT_RETRY_DELAYS_MS = [1_000, 4_000, 16_000]", doc: "DEFAULT_RETRY_DELAYS_MS = [1000, 4000, 16000]" },
  { file: "headless-runtime/opencodeServerManager.ts", code: "HEALTH_RETRIES = 3", doc: "HEALTH_RETRIES = 3" },
  { file: "headless-runtime/opencodeServerManager.ts", code: "SERVER_START_RETRIES = 3", doc: "SERVER_START_RETRIES = 3" },
  { file: "headless-runtime/interview/engine.ts", code: "MAX_STRUCTURED_RETRIES = 2", doc: "MAX_STRUCTURED_RETRIES = 2" },
  { file: "headless-runtime/factory/agentLoader.ts", code: "samplingRate: 25", doc: "samplingRate: 25" },
  { file: "headless-runtime/foreman/foremanLog.ts", code: "RING_MAX = 500", doc: "RING_MAX = 500" },
  { file: "headless-runtime/event-bus.ts", code: "MAX_RECENT_EVENTS = 100", doc: "MAX_RECENT_EVENTS = 100" },
  { file: "headless-runtime/review/reverifyAllowlist.ts", code: "REVERIFY_EVIDENCE_MAX_BYTES = 8 * 1024", doc: "REVERIFY_EVIDENCE_MAX_BYTES = 8KB" },
  { file: "headless-runtime/review/reviewDisk.ts", code: "REVIEW_RAW_MAX_BYTES = 64 * 1024", doc: "REVIEW_RAW_MAX_BYTES = 64KB" },
  { file: "headless-runtime/measure/scorerLoader.ts", code: "SCORER_MAX_FILE_BYTES = 64 * 1024", doc: "SCORER_MAX_FILE_BYTES = 64KB" },
  { file: "headless-runtime/factory/agentLoader.ts", code: "SKILL_MAX_BYTES = 8 * 1024", doc: "SKILL_MAX_BYTES = 8KB" },
  // Auditoría 2026-09-16: cotas de auto-resume del engine (E10) y de
  // restart del runner supervisor (RS01).
  { file: "headless-runtime/factory/engineBridge.ts", code: "AUTO_RESUME_MAX_ATTEMPTS = 3", doc: "AUTO_RESUME_MAX_ATTEMPTS = 3" },
  { file: "headless-runtime/factory/github/runnerSupervisor.ts", code: "RUNNER_MAX_RESTARTS = 5", doc: "RUNNER_MAX_RESTARTS = 5" },
];

// ── Escaneo ─────────────────────────────────────────────────────────────────

type Kind = Bounded["kind"];

const PATTERNS: Readonly<Record<Kind, RegExp>> = {
  interval: /setInterval\s*\(/,
  timeout: /setTimeout\s*\(/,
  while: /while\s*\(/,
  for: /for\s*\(/,
  retry: /\bretry\b/i,
};

interface Match {
  file: string;
  line: number;
  kind: Kind;
  text: string;
}

function scanFile(fileRel: string): Match[] {
  const text = fs.readFileSync(path.join(REPO, fileRel), "utf-8");
  const lines = text.split("\n");
  const out: Match[] = [];
  lines.forEach((content, idx) => {
    (Object.keys(PATTERNS) as Kind[]).forEach((kind) => {
      if (PATTERNS[kind].test(content)) {
        out.push({ file: fileRel, line: idx + 1, kind, text: content.trim().slice(0, 140) });
      }
    });
  });
  return out;
}

function needleLines(fileRel: string, needle: string): number[] {
  const text = fs.readFileSync(path.join(REPO, fileRel), "utf-8");
  const lines = text.split("\n");
  const out: number[] = [];
  lines.forEach((content, idx) => {
    if (content.includes(needle)) out.push(idx + 1);
  });
  return out;
}

function isCovered(match: Match): boolean {
  // Exención 1: for acotado por archivo (más `for(;;)` prohibido aparte).
  if (match.kind === "for" && (FOR_EXEMPT_FILES as readonly string[]).includes(match.file)) {
    return true;
  }
  // Exención 3: nombres retry que no son loops.
  if (
    match.kind === "retry" &&
    (RETRY_EXEMPT_TOKENS as readonly string[]).some((t) => match.text.includes(t))
  ) {
    return true;
  }
  // Entrada justificada con needle cercano.
  return BOUNDED.some(
    (e) =>
      e.file === match.file &&
      e.kind === match.kind &&
      needleLines(e.file, e.needle).some((n) => Math.abs(n - match.line) <= WINDOW),
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("docs/LOOPS.md existe con Exenciones y veredicto SIN COTA", () => {
  assert.ok(fs.existsSync(LOOPS_MD), "falta docs/LOOPS.md");
  const doc = fs.readFileSync(LOOPS_MD, "utf-8");
  assert.ok(doc.includes("## Exenciones"), "falta la sección ## Exenciones");
  assert.ok(doc.includes("SIN COTA"), "falta el veredicto SIN COTA");
});

test("cada match de patrón-loop está justificado o exento (si no, registralo)", () => {
  const files = daemonFiles();
  assert.ok(files.length > 20, `se esperaban decenas de archivos del daemon, hay ${files.length}`);
  const matches = files.flatMap((f) => scanFile(f));
  assert.ok(matches.length > 50, `el escaneo debió hallar decenas de matches, halló ${matches.length}`);
  const uncovered = matches.filter((m) => !isCovered(m));
  assert.deepEqual(
    uncovered.map((m) => `${m.file}:${m.line} [${m.kind}] ${m.text}`),
    [],
    "matches de patrón-loop SIN justificación en docs/LOOPS.md ni exención en este test",
  );
});

test("cada entrada BOUNDED cita constante real del código y fila del doc (anti-drift)", () => {
  const doc = fs.readFileSync(LOOPS_MD, "utf-8");
  const problems: string[] = [];
  for (const e of BOUNDED) {
    const occurrences = needleLines(e.file, e.needle);
    if (occurrences.length === 0) {
      problems.push(`needle ausente en código: ${e.file} :: ${e.needle}`);
      continue;
    }
    const fileText = fs.readFileSync(path.join(REPO, e.file), "utf-8");
    const fileLines = fileText.split("\n");
    const capNear = occurrences.some((n) =>
      fileLines
        .slice(Math.max(0, n - 1 - WINDOW), Math.min(fileLines.length, n - 1 + WINDOW + 1))
        .some((l) => l.includes(e.capText)),
    );
    if (!capNear) problems.push(`capText ausente cerca del needle: ${e.file} :: ${e.capText}`);
    if (!doc.includes(e.doc)) problems.push(`fila ausente en docs/LOOPS.md: ${e.doc}`);
  }
  assert.deepEqual(problems, [], "drift entre código y docs/LOOPS.md");
});

test("los números de docs/LOOPS.md siguen iguales en el código", () => {
  const doc = fs.readFileSync(LOOPS_MD, "utf-8");
  const problems: string[] = [];
  for (const c of CONSTANTS) {
    const fileText = fs.readFileSync(path.join(REPO, c.file), "utf-8");
    if (!fileText.includes(c.code)) problems.push(`cota cambió en código: ${c.file} :: ${c.code}`);
    if (!doc.includes(c.doc)) problems.push(`cota ausente en docs/LOOPS.md: ${c.doc}`);
  }
  assert.deepEqual(problems, [], "drift de constantes");
});

test("prohibido for(;;) y while(true) en el daemon", () => {
  const bad: string[] = [];
  for (const f of daemonFiles()) {
    const text = fs.readFileSync(path.join(REPO, f), "utf-8");
    text.split("\n").forEach((content, idx) => {
      if (/for\s*\(\s*;\s*;/.test(content)) bad.push(`${f}:${idx + 1} for(;;)`);
      if (/while\s*\(\s*true\s*\)/.test(content)) bad.push(`${f}:${idx + 1} while(true)`);
    });
  }
  assert.deepEqual(bad, [], "loops infinitos literales en el daemon");
});
