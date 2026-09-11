/**
 * Rutas HTTP de workflows (Fase 4b).
 *
 * Viven como handler pre-tabla (mismo patrón que agentFileRoutes): la tabla
 * canónica de factory queda intacta. Endpoints bajo /factory/workflows:
 *
 *   GET  /factory/workflows                 → lista descubierta (repo > global > bundled)
 *   POST /factory/workflows/run             → { name, inputs?, args? } lanza en background
 *   GET  /factory/workflows/runs            → runs persistidos (más recientes primero)
 *   GET  /factory/workflows/runs/:id        → detalle + gate pendiente
 *   POST /factory/workflows/runs/:id/approve|reject  → { text? } resuelve el gate
 *   POST /factory/workflows/runs/:id/cancel → aborta el run activo
 */

import type http from "node:http";
import { isSafeRouteId } from "../factory/routing/routeParsers";
import { listWorkflowSummaries, loadWorkflow } from "./loader";
import type { WorkflowRuntime } from "./runtime";

const PREFIX = "/factory/workflows";
const MAX_BODY_BYTES = 256 * 1024;

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = req as unknown as {
      on: (event: string, listener: (...args: never[]) => void) => void;
      destroy: () => void;
    };
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        stream.destroy();
        reject(new Error("body demasiado grande"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    stream.on("error", (error: Error) => reject(error));
  });
}

export type WorkflowRouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
) => Promise<boolean>;

export function createWorkflowRouteHandler(
  getRuntime: () => WorkflowRuntime,
  getRepoRoot: () => string,
): WorkflowRouteHandler {
  return async (req, res, pathname) => {
    if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) {
      return false;
    }
    const method = req.method ?? "GET";
    const segments = pathname
      .slice(PREFIX.length)
      .split("/")
      .filter((part) => part.length > 0);

    try {
      if (method === "GET" && segments.length === 0) {
        const workflows = listWorkflowSummaries({ repoRoot: getRepoRoot() });
        sendJson(res, 200, { workflows });
        return true;
      }

      if (
        method === "POST" &&
        segments.length === 1 &&
        segments[0] === "run"
      ) {
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
          sendJson(res, 400, { ok: false, error: "name requerido" });
          return true;
        }
        const inputs =
          body.inputs && typeof body.inputs === "object"
            ? (body.inputs as Record<string, unknown>)
            : undefined;
        const args = typeof body.args === "string" ? body.args : undefined;
        const run = await getRuntime().start(name, { inputs, args });
        sendJson(res, 201, { ok: true, run });
        return true;
      }

      if (
        method === "GET" &&
        segments.length === 1 &&
        segments[0] === "runs"
      ) {
        sendJson(res, 200, { runs: getRuntime().listRuns(50) });
        return true;
      }

      if (method === "GET" && segments.length === 1) {
        const name = segments[0];
        if (!isSafeRouteId(name)) {
          sendJson(res, 400, { ok: false, error: "workflow name inválido" });
          return true;
        }
        try {
          const loaded = loadWorkflow(name, { repoRoot: getRepoRoot() });
          sendJson(res, 200, {
            workflow: {
              name: loaded.def.name,
              description: loaded.def.description,
              tags: loaded.def.tags,
              scope: loaded.scope,
              filePath: loaded.sourcePath,
              def: loaded.def,
            },
            source: loaded.source,
          });
        } catch (error) {
          sendJson(res, 404, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return true;
      }

      if (segments[0] === "runs" && segments.length >= 2) {        const runId = segments[1];
        if (!isSafeRouteId(runId)) {
          sendJson(res, 400, { ok: false, error: "run id inválido" });
          return true;
        }
        const runtime = getRuntime();

        if (method === "GET" && segments.length === 2) {
          const run = runtime.getRun(runId);
          if (!run) {
            sendJson(res, 404, { ok: false, error: `run "${runId}" no existe` });
            return true;
          }
          sendJson(res, 200, { run, pending: runtime.getPending(runId) });
          return true;
        }

        if (method === "POST" && segments.length === 3) {
          const action = segments[2];
          if (action === "cancel") {
            runtime.cancel(runId);
            sendJson(res, 200, { ok: true });
            return true;
          }
          if (isSafeRouteId(action)) {
            const body = await readJsonBody(req);
            const text = typeof body.text === "string" ? body.text : undefined;
            runtime.respond(runId, { decision: action, text });
            sendJson(res, 200, { ok: true });
            return true;
          }
        }
      }

      sendJson(res, 404, { error: `not found: ${method} ${pathname}` });
      return true;
    } catch (error) {
      sendJson(res, 409, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  };
}
