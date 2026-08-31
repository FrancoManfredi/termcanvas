// Frontera con opencode. El servidor se levanta UNA sola vez por proceso
// (o se reusa uno ya corriendo) y cada turno es un session.prompt a un
// servidor caliente — no se spawnea el CLI por pregunta. Nada de este
// archivo se expone fuera del módulo interview: la API pública es el
// engine (createInterview / submitAnswer / loadInterviewState / listInterviews).

import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { NEXT_QUESTION_SCHEMA } from "./schema.ts";
import {
  InterviewEngineError,
  describeInterviewQuestionIssue,
  isValidInterviewQuestion,
  type InterviewQuestion,
} from "./types.ts";

// Contrato mínimo que el engine consume. Los tests inyectan un fake de
// esta interfaz; la producción usa OpenCodeModelGateway.
export interface InterviewModelGateway {
  readonly modelID: string;
  createSession(title: string, directory: string): Promise<string>;
  nextQuestion(input: { sessionId: string; turnPrompt: string }): Promise<InterviewQuestion>;
}

export const PROVIDER_ID = "opencode-go";
export const SERVER_HOST = "127.0.0.1";
export const SERVER_PORT = 4096;
const SERVER_BASE_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
// El servidor reintenta internamente el structured output N veces antes
// de devolver StructuredOutputError (mismo valor por defecto del SDK).
const STRUCTURED_RETRY_COUNT = 2;
const SERVER_START_TIMEOUT_MS = 10_000;

interface ServerHandle {
  url: string;
  close: () => void;
}

let runningServer: ServerHandle | null = null;

async function serverIsHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/app`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

// Reusa un server ya corriendo en el puerto por defecto; si no hay,
// levanta `opencode serve` como child process del SDK (hereda la auth de
// ~/.local/share/opencode/auth.json del usuario). Singleton por proceso.
export async function ensureInterviewServer(): Promise<ServerHandle> {
  if (runningServer) return runningServer;

  if (await serverIsHealthy(SERVER_BASE_URL)) {
    runningServer = { url: SERVER_BASE_URL, close: () => {} };
    return runningServer;
  }

  try {
    const server = await createOpencodeServer({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      timeout: SERVER_START_TIMEOUT_MS,
    });
    runningServer = { url: server.url, close: () => server.close() };
    return runningServer;
  } catch (err) {
    throw new InterviewEngineError(
      "server_unavailable",
      `No se pudo conectar ni levantar el servidor de opencode en ${SERVER_BASE_URL}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// Cierra el servidor levantado por este proceso (no toca uno que ya
// estuviera corriendo). Útil para la salida limpia de scripts y tests.
export function closeInterviewServer(): void {
  if (runningServer) {
    runningServer.close();
    runningServer = null;
  }
}

function describeRequestError(error: unknown): string {
  if (error === null || error === undefined) return "respuesta vacía";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error).slice(0, 300);
  } catch {
    return String(error);
  }
}

export class OpenCodeModelGateway implements InterviewModelGateway {
  readonly modelID: string;
  private client: OpencodeClient | null = null;

  constructor(
    modelID: string,
    private readonly providerID: string = PROVIDER_ID,
    private readonly variant?: string,
  ) {
    this.modelID = modelID;
  }

  private async clientFor(): Promise<OpencodeClient> {
    if (this.client) return this.client;
    const server = await ensureInterviewServer();
    this.client = createOpencodeClient({ baseUrl: server.url });
    return this.client;
  }

  async createSession(title: string, directory: string): Promise<string> {
    const client = await this.clientFor();
    const result = await client.session.create({
      title,
      directory,
    });
    if (result.error || !result.data) {
      throw new InterviewEngineError(
        "model_request_failed",
        `No se pudo crear la sesión: ${describeRequestError(result.error)}`,
        result.error,
      );
    }
    return result.data.id;
  }

  async nextQuestion(input: { sessionId: string; turnPrompt: string }): Promise<InterviewQuestion> {
    const client = await this.clientFor();
    const result = await client.session.prompt({
      sessionID: input.sessionId,
      model: { providerID: this.providerID, modelID: this.modelID },
      ...(this.variant ? { variant: this.variant } : {}),
      format: {
        type: "json_schema",
        schema: NEXT_QUESTION_SCHEMA as Record<string, unknown>,
        retryCount: STRUCTURED_RETRY_COUNT,
      },
      parts: [{ type: "text", text: input.turnPrompt }],
    });

    if (result.error || !result.data) {
      throw new InterviewEngineError(
        "model_request_failed",
        `La llamada al modelo falló: ${describeRequestError(result.error)}`,
        result.error,
      );
    }

    const info = result.data.info;
    if (info.error?.name === "StructuredOutputError") {
      throw new InterviewEngineError(
        "structured_output_error",
        `El modelo no pudo generar una pregunta que cumpla el schema después de ${STRUCTURED_RETRY_COUNT} reintentos`,
        info.error,
      );
    }
    if (info.error) {
      throw new InterviewEngineError("model_request_failed", `Error del modelo: ${info.error.name}`, info.error);
    }

    const structured = info.structured;
    if (!isValidInterviewQuestion(structured)) {
      throw new InterviewEngineError(
        "invalid_question",
        `El modelo devolvió un objeto que no cumple el contrato de pregunta: ${describeInterviewQuestionIssue(structured) ?? "motivo desconocido"}`,
        structured,
      );
    }

    return {
      ...structured,
      contradiction_flag: structured.contradiction_flag ?? null,
    };
  }
}
