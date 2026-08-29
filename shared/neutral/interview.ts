/**
 * Neutral Interview Harness — core sin atar a opencode ni a ningún CLI.
 *
 * Si opencode muere mañana, el próximo harness (mycli) entra sin tocar
 * headless-runtime/interview/engine.ts: solo añade un archivo en
 * headless-runtime/interview/harness/<harness>.ts y lo registra en
 * harness/index.ts.
 *
 * El engine SIEMPRE resuelve el harness vía phaseCliRef(phaseId):
 *   - fases SDK (brief/requirements/synthesis/gapCheck/asrReview/tactics)
 *     hoy usan "opencode" por default, pero pueden usar "codebuddy" si
 *     el harness lo soporta.
 *   - fases CLI (diagnosisLlm) ya usan el harness del CLI elegido.
 *
 * Cada harness decide CÓMO ejecutar el prompt estructurado:
 *   - opencode: server efímero + SDK (json_schema nativo)
 *   - codebuddy: spawn `codebuddy -p --output-format json --model <id> <prompt>`
 *     + instrucción de schema en el prompt + parse JSON con Zod fallback
 *   - futuro mycli: su propio spawn/API
 *
 * Contrato mínimo para que engine.ts pueda hacer reintentos y gate
 * sin conocer el harness.
 */

import type { ModelRef } from "../phaseModels.ts";
import type { CliCatalogSource } from "../modelCatalog.ts";

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface HarnessPromptResult {
  /** JSON ya parseado del stdout del modelo (antes de Zod). */
  raw: unknown;
  usage: ModelUsage;
  /** Para diagnóstico (opencode: info.structured tokens, codebuddy: stdout). */
  meta?: unknown;
}

export interface HarnessInterviewAdapter {
  readonly harnessId: CliCatalogSource;

  /**
   * Asegura que el harness esté listo (levanta server, verifica binario).
   * Llamado una vez por entrevista antes del primer prompt.
   * Debe ser idempotente.
   */
  ensureReady(): Promise<void>;

  /**
   * Crea una sesión. Para opencode es `client.session.create` con storage;
   * para CLIs stateless puede devolver un id efímero (ej. `codebuddy-<ts>`).
   * El engine persiste `ledger.session_id` con lo que devuelva.
   */
  createSession(opts: { projectPath: string; title: string }): Promise<{ id: string }>;

  /**
   * Borra sesión best-effort. No debe lanzar si ya no existe.
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Llamada estructurada ÚNICA (sin reintentos). El engine hace reintentos,
   * validación Zod, overflow/session-recreate y gate.
   * Debe respetar `signal` (abort) y `timeoutMs` (AbortSignal.timeout ya viene
   * combinado por el engine, pero el harness puede usarlo para kill del child).
   */
  promptStructuredRaw(opts: {
    sessionId: string;
    projectPath: string;
    model: ModelRef;
    text: string;
    schema: Record<string, unknown>;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<HarnessPromptResult>;

  /** Cierra recursos globales del harness (server). Idempotente. */
  close(): void;
}

/**
 * Registry — fuente única de harnesses soportados.
 * Añadir un harness = añadir id acá y registrar adapter en
 * headless-runtime/interview/harness/index.ts.
 */
export const SUPPORTED_INTERVIEW_HARNESSES = ["opencode", "codebuddy", "claude", "codex", "gemini", "kimi", "wuu"] as const;
export type InterviewHarnessId = (typeof SUPPORTED_INTERVIEW_HARNESSES)[number];
