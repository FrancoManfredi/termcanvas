/**
 * Opencode harness — adapter que habla con el server efímero de opencode
 * vía @opencode-ai/sdk/v2. Es el harness "de referencia" y el que hoy usa
 * la entrevista en producción (brief/requirements/synthesis/gapCheck/asrReview).
 *
 * Al extraerlo acá, engine.ts deja de importar createOpencodeServer directo
 * y pasa a depender de la interfaz neutra HarnessInterviewAdapter.
 */

import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { encontrarPuertoServidor } from "../puerto-libre.ts";
import type { ModelRef } from "../../../shared/phaseModels.ts";
import type { HarnessInterviewAdapter, HarnessPromptResult } from "../../../shared/neutral/interview.ts";

const SERVER_START_TIMEOUT_MS = 30_000;
const SERVER_START_RETRIES = 2;

interface ServerHandle {
  url: string;
  close: () => void;
}

let runningServer: ServerHandle | null = null;
let runningClient: OpencodeClient | null = null;

export function setTestClient(client: OpencodeClient | null): void {
  if (runningServer) {
    runningServer.close();
    runningServer = null;
  }
  runningClient = client;
}

export async function ensureClient(): Promise<OpencodeClient> {
  if (!runningClient) {
    let lastError: unknown;
    for (let attempt = 0; attempt < SERVER_START_RETRIES; attempt++) {
      try {
        const port = await encontrarPuertoServidor(20000, 45000);
        const server = await createOpencodeServer({
          hostname: "127.0.0.1",
          port,
          timeout: SERVER_START_TIMEOUT_MS,
        });
        runningServer = server;
        runningClient = createOpencodeClient({ baseUrl: server.url });
        return runningClient;
      } catch (err) {
        lastError = err;
        console.warn(
          `[interview:opencode] no se pudo arrancar el server (intento ${attempt + 1}/${SERVER_START_RETRIES}): ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt < SERVER_START_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No se pudo arrancar el server de opencode.");
  }
  return runningClient;
}

export function closeInterviewServer(): void {
  if (runningServer) {
    runningServer.close();
    runningServer = null;
  }
  runningClient = null;
}

export const opencodeHarness: HarnessInterviewAdapter = {
  harnessId: "opencode",

  async ensureReady(): Promise<void> {
    await ensureClient();
  },

  async createSession(opts: { projectPath: string; title: string }): Promise<{ id: string }> {
    const client = await ensureClient();
    const sesion = await client.session.create({
      title: opts.title,
      directory: opts.projectPath,
    });
    if (sesion.error || !sesion.data) {
      throw new Error(`No se pudo crear la sesión: ${JSON.stringify(sesion.error)}`);
    }
    return { id: sesion.data.id };
  },

  async deleteSession(sessionId: string): Promise<void> {
    if (!runningClient) return;
    try {
      await runningClient.session.delete({ sessionID: sessionId });
    } catch {
      // best-effort
    }
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
    const client = await ensureClient();
    const respuesta = await client.session.prompt(
      {
        sessionID: opts.sessionId,
        model: { providerID: opts.model.providerID, modelID: opts.model.modelID },
        ...(opts.model.variant ? { variant: opts.model.variant } : {}),
        tools: {},
        parts: [{ type: "text", text: opts.text }],
        format: { type: "json_schema", schema: opts.schema },
      },
      { signal: opts.signal },
    );

    if (respuesta.error || !respuesta.data) {
      const serializado = JSON.stringify(respuesta.error);
      // Dejamos que el engine decida si es Session not found, retry, etc.
      throw Object.assign(new Error(`Opencode prompt falló: ${serializado}`), {
        _rawError: respuesta.error,
        _serializado: serializado,
      });
    }

    const info = respuesta.data.info as {
      error?: { name?: string; message?: string } | null;
      structured?: unknown;
      tokens?: { input?: number; output?: number } | null;
    };

    if (info.error) {
      const err = Object.assign(new Error(`Opencode model error: ${info.error.name ?? "Unknown"}`), {
        _infoError: info.error,
      });
      (err as unknown as Record<string, unknown>)._infoError = info.error;
      throw err;
    }

    return {
      raw: info.structured,
      usage: {
        input_tokens: info.tokens?.input ?? 0,
        output_tokens: info.tokens?.output ?? 0,
      },
      meta: info,
    };
  },

  close(): void {
    closeInterviewServer();
  },
};
