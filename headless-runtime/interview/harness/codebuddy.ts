/**
 * CodeBuddy harness — adapter que habla con `codebuddy -p` (headless).
 * No usa server efímero ni SDK; spawnea el binario con el modelo elegido.
 *
 * Tradeoff: CodeBuddy no tiene `json_schema` nativo como opencode, así que
 * el prompt incluye el schema como texto y se parsea el stdout como JSON.
 * Si el modelo devuelve markdown con ```json, se extrae el bloque.
 */

import { spawn } from "node:child_process";
import type { ModelRef } from "../../../shared/phaseModels.ts";
import type { HarnessInterviewAdapter, HarnessPromptResult } from "../../../shared/neutral/interview.ts";
import { isCliAvailable } from "../../../electron/model-catalog.ts";

// ─── Test seam ────────────────────────────────────────────────────────
type MockHandler = (opts: {
  sessionId: string;
  projectPath: string;
  model: ModelRef;
  text: string;
  schema: Record<string, unknown>;
}) => Promise<HarnessPromptResult>;

let mockHandler: MockHandler | null = null;

export function __setMockCodebuddyHandler(handler: MockHandler | null): void {
  mockHandler = handler;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  // 1. Intenta parse directo
  try {
    return JSON.parse(trimmed);
  } catch {}
  // 2. Busca bloque ```json ... ```
  const codeBlock = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim());
    } catch {}
  }
  // 3. Busca primer { ... } balanceado (heurística simple)
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new Error(`No se pudo extraer JSON del output de codebuddy: ${trimmed.slice(0, 500)}`);
}

function buildCodebuddyPrompt(text: string, schema: Record<string, unknown>): string {
  // Instrucción explícita para que el modelo devuelva SOLO JSON válido
  return `${text}

---
INSTRUCCIÓN DE FORMATO (OBLIGATORIA):
Debes responder SOLO con un JSON válido que cumpla este JSON Schema (sin markdown, sin explicación, sin \`\`\`):
${JSON.stringify(schema, null, 2)}
Si no puedes cumplir el schema, devuelve el JSON más cercano posible — nunca texto libre.
`;
}

// ─── Harness ──────────────────────────────────────────────────────────

export const codebuddyHarness: HarnessInterviewAdapter = {
  harnessId: "codebuddy",

  async ensureReady(): Promise<void> {
    if (!isCliAvailable("codebuddy")) {
      throw new Error(
        `CodeBuddy no está disponible en PATH. Instalá CodeBuddy y verificá con \`codebuddy --version\`.`,
      );
    }
  },

  async createSession(_opts: { projectPath: string; title: string }): Promise<{ id: string }> {
    // CodeBuddy -p es stateless; generamos id efímero para ledger compat
    return { id: `codebuddy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  },

  async deleteSession(_sessionId: string): Promise<void> {
    // no-op: no hay server que limpiar
  },

  async promptStructuredRaw(opts: {
    sessionId: string;
    projectPath: string;
    model: ModelRef;
    text: string;
    schema: Record<string, unknown>;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<HarnessPromptResult> {
    if (mockHandler) {
      return mockHandler(opts);
    }

    await (async () => {
      if (!isCliAvailable("codebuddy")) {
        throw new Error(`CodeBuddy no está instalado (isCliAvailable=false)`);
      }
    })();

    const prompt = buildCodebuddyPrompt(opts.text, opts.schema);
    // CodeBuddy espera solo modelID (ej. fast-model), no provider/model
    const modelId = opts.model.modelID;

    return new Promise<HarnessPromptResult>((resolve, reject) => {
      if (opts.signal.aborted) {
        reject(Object.assign(new Error("Operación cancelada"), { name: "InterviewCancelledError" }));
        return;
      }

      const args = ["-p", "--output-format", "json", "--model", modelId, prompt];
      const child = spawn("codebuddy", args, {
        cwd: opts.projectPath,
        windowsHide: true,
        // No shell: spawn directo evita quoting issues de PowerShell
        // Timeout a nivel harness: el engine ya pasa AbortSignal.timeout, pero
        // por si acaso, también kill tras timeoutMs + margen
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const cleanup = () => {
        opts.signal.removeEventListener("abort", onAbort);
        clearTimeout(killTimer);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch {}
        cleanup();
        reject(Object.assign(new Error("Operación cancelada por el usuario"), { name: "InterviewCancelledError" }));
      };
      opts.signal.addEventListener("abort", onAbort);

      // Kill de seguridad si el CLI cuelga (margen 5s sobre timeout del engine)
      const killTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        cleanup();
        reject(new Error(`CodeBuddy no respondió en ${opts.timeoutMs}ms (timeout)`));
      }, opts.timeoutMs + 5000);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      (child as any).on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`No se pudo spawnear codebuddy: ${err.message}`));
      });

      (child as any).on("close", (code: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (signal === "SIGKILL" || signal === "SIGTERM") {
          reject(new Error(`CodeBuddy terminado por señal ${signal} (timeout o cancel)`));
          return;
        }

        // CodeBuddy headless con --output-format json: exit 0 esperado
        // Si hay stderr con error 400 model not found, lo detectamos
        const output = stdout.trim() || stderr.trim();
        if (code !== 0 && !output) {
          reject(new Error(`CodeBuddy exit ${code} sin output. stderr: ${stderr.slice(0, 500)}`));
          return;
        }
        if (output.includes("Authentication required") || output.includes("Please use /login")) {
          reject(new Error(`CodeBuddy requiere autenticación: ejecutá \`codebuddy login\` o \`codebuddy /login\` y reintentá. Output: ${output.slice(0, 600)}`));
          return;
        }
        if (output.includes("service info not found") || output.includes("400 model")) {
          reject(new Error(`CodeBuddy modelo no encontrado: ${output.slice(0, 800)}`));
          return;
        }

        try {
          // Con --output-format json, codebuddy puede envolver en {result, ...} o devolver JSON directo
          // Intentamos parsear y desanidar si viene envuelto
          const parsed = extractJsonFromOutput(output);
          // Si el JSON viene envuelto como { result: ... } o { data: ... }, desanidar
          let raw: unknown = parsed;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const obj = parsed as Record<string, unknown>;
            // Heurística para formatos de codebuddy: si tiene 'result' o 'content' que es JSON string, desanidar
            if (obj.result && typeof obj.result === "string") {
              try {
                raw = JSON.parse(obj.result as string);
              } catch {
                raw = obj.result;
              }
            } else if (obj.output && typeof obj.output === "string") {
              try {
                raw = JSON.parse(obj.output as string);
              } catch {
                raw = obj.output;
              }
            } else if (obj.data && typeof obj.data === "object") {
              raw = obj.data;
            }
          }
          resolve({
            raw,
            usage: { input_tokens: 0, output_tokens: 0 }, // CodeBuddy no expone tokens en este modo
            meta: { stdout: output.slice(0, 2000), stderr: stderr.slice(0, 500), code },
          });
        } catch (err) {
          reject(new Error(`CodeBuddy output no es JSON válido: ${(err as Error).message}. Output: ${output.slice(0, 800)}`));
        }
      });
    });
  },

  close(): void {
    // no-op: no hay server
  },
};
