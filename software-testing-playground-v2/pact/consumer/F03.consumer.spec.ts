import { describe, it, expect } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import {
  PACT_DIR,
  PACT_LOG_LEVEL,
  FACTORY_PROVIDER,
  consumerNameFor,
} from "../support/pactConfig.js";

const { like, regex, eachLike } = MatchersV3;

/**
 * F03 — Worker + logs + SSE (Pact híbrido)
 *
 * Este spec es **híbrido** como define architecture-pact-v2.md §3.3:
 *
 *  PACT (mock + Verifier) cubre:
 *   - GET /factory/jobs/:id  → 200 con state "done", logs, resultPreview (polling)
 *   - GET /factory/jobs/:id/events → 200 handshake con Content-Type: text/event-stream (solo headers + primer evento)
 *
 *  NO PACTEABLE (requiere helper humano):
 *   - El stream vivo SSE (data: ... cada 700ms, heartbeat cada 15s, event: done al final) NO puede ser
 *     validado por Pact porque Pact es request→response síncrono y SSE es request→stream infinito keep-alive.
 *     Pact solo valida que el endpoint existe y responde 200 + header correcto. El contenido del stream
 *     en el tiempo se valida fuera de Pact con `pact/support/sseHelper.ts` → `collectSse(url, timeoutMs)`
 *     que hace fetch con AbortController, o manualmente con:
 *       curl.exe --silent -H "Accept: text/event-stream" http://127.0.0.1:17680/factory/jobs/<id>/events
 *       Get-Content <worktree>/.agents/factory/<id>/logs.ndjson -Wait
 *
 *  Por eso este archivo documenta la limitación y NO intenta mockear el stream con Pact.
 *  El Verifier validará HTTP; el helper valida SSE vivo por separado (no bloquea p:verify, pero se documenta).
 *
 * Contratos:
 *  - given "a job that has completed"  → GET /factory/jobs/:id  → 200 done
 *  - given "a job with SSE available"  → GET /factory/jobs/:id/events → 200 text/event-stream
 *
 * Matchers usados: regex para id/path/timestamps/state, like para strings flexibles, eachLike para logs array.
 * Windows only — worktree ejemplo usa ruta Windows C:\tmp\...
 */

// Regex helpers locales (consistentes con matchers.ts pero inline para claridad del contrato)
const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_EXAMPLE = "job-abc123";
const WINDOWS_PATH_REGEX = "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_PATH_EXAMPLE = "C:\\tmp\\playground-F03-abc\\.agents\\factory\\job-abc123";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*";
const WINDOWS_WORKTREE_EXAMPLE = "C:\\tmp\\playground-F03-abc";
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";

describe("F03 — Worker + logs + SSE (hybrid Pact)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F03"), // "playground-F03"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("polls job until done and verifies SSE handshake (stream vivo fuera de Pact)", async () => {
    // ── Interaction 1: GET /factory/jobs/:id → done (polling) ──
    // Pact valida que el provider responde 200 con job en estado done y artifacts.
    // El provider state handler se encarga de crear un job real vía POST y esperar hasta done
    // (stub: 700ms queued→running, 2200ms running→done). Ver pact/provider/verify.ts.
    pact
      .given("a job that has completed", { id: JOB_ID_EXAMPLE })
      .uponReceiving("a request for a completed job")
      .withRequest({
        method: "GET",
        path: regex("^\\/factory\\/jobs\\/job-[a-z0-9\\-]+$", `/factory/jobs/${JOB_ID_EXAMPLE}`),
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          id: regex(JOB_ID_REGEX, JOB_ID_EXAMPLE),
          prompt: like("playground-F03-abc123"),
          worktree: regex(WINDOWS_WORKTREE_REGEX, WINDOWS_WORKTREE_EXAMPLE),
          phase: like("diagnosisLlm"),
          state: regex("^done$", "done"),
          createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          updatedAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          logs: eachLike("opencode: streaming tokens…"),
          dir: regex(WINDOWS_PATH_REGEX, WINDOWS_PATH_EXAMPLE),
          resultPreview: {
            jobId: regex(JOB_ID_REGEX, JOB_ID_EXAMPLE),
            phase: like("diagnosisLlm"),
            worktree: regex(WINDOWS_WORKTREE_REGEX, WINDOWS_WORKTREE_EXAMPLE),
            state: regex("^done$", "done"),
            promptPreview: like("playground-F03-abc123"),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
            summary: like("Job completado correctamente (local)."),
          },
        },
      });

    // ── Interaction 2: GET /factory/jobs/:id/events → 200 text/event-stream (handshake) ──
    // IMPORTANTE: Pact solo valida handshake (status + header). El body se define como like string
    // para satisfacer Pact, pero NO se valida el stream vivo. La validación real del stream
    // (que llegan ≥1 data: lines en 3s) se hace con collectSse() fuera de Pact.
    // Ver pact/support/sseHelper.ts y docs §3.3 tabla comparativa.
    pact
      .given("a job with SSE available", { id: JOB_ID_EXAMPLE })
      .uponReceiving("a request for job events SSE")
      .withRequest({
        method: "GET",
        path: regex(
          "^\\/factory\\/jobs\\/job-[a-z0-9\\-]+\\/events$",
          `/factory/jobs/${JOB_ID_EXAMPLE}/events`,
        ),
        headers: { Accept: "text/event-stream" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        // NOTA: SSE vivo no es pacteable — Pact solo valida handshake (status 200 + Content-Type).
        // El body del stream (data: ... cada 700ms, heartbeat, event: done) NO se valida aquí.
        // El Verifier anterior fallaba con "error decoding response body" cuando usábamos like() para body
        // con text/event-stream, porque Pact serializa el matcher como JSON string y el Rust verifier lo comparaba
        // con igualdad estricta contra el body real (múltiples líneas). Por eso este spec híbrido omite body:
        // la validación real del stream se hace fuera de Pact con sseHelper.collectSse() (ver soporte).
        // Si en el futuro se quiere validar body, usar matcher regex con contentType explícito y matchingRules,
        // pero por ahora handshake es suficiente para F03 (ver architecture-pact-v2.md §3.3 tabla comparativa).
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validación mock (Pact) — no requiere Factory real ──
      // Estos fetches van contra el mock server de Pact, no contra Factory.

      // 1. Handshake SSE — solo status + header, no body (stream vivo fuera de Pact)
      // Ver comentario híbrido arriba: Pact no valida data: ... en el tiempo.
      // El mock de Pact para este interaction no tiene body (handshake-only), así que solo validamos headers.
      // La validación real del stream se hace con sseHelper.collectSse() fuera de este spec.
      const resEvents = await fetch(`${mockServer.url}/factory/jobs/${JOB_ID_EXAMPLE}/events`, {
        headers: { Accept: "text/event-stream" },
      });
      expect(resEvents.status).toBe(200);
      const ctype = resEvents.headers.get("content-type") ?? "";
      expect(ctype).toMatch(/text\/event-stream/);
      // No validar body aquí — el body del stream vivo se valida con helper humano (ver sseHelper.ts).
      // Si se quiere validar que el mock responde algo, se puede leer texto pero sin exigir data: prefix.
      // const eventsBody = await resEvents.text(); // puede ser vacío en mock handshake-only

      // 2. Polling job done
      const resJob = await fetch(`${mockServer.url}/factory/jobs/${JOB_ID_EXAMPLE}`, {
        headers: { Accept: "application/json" },
      });
      expect(resJob.status).toBe(200);
      const body = (await resJob.json()) as unknown as {
        id: unknown;
        state: unknown;
        logs: unknown;
        dir: unknown;
        resultPreview: { state: unknown; jobId: unknown };
      };
      expect(typeof body.id).toBe("string");
      expect(body.state).toBe("done");
      expect(Array.isArray(body.logs)).toBe(true);
      expect(typeof body.dir).toBe("string");
      expect(body.resultPreview.state).toBe("done");

      // Nota para reviewer: Aquí NO se valida stream vivo. Para validar SSE vivo fuera de Pact:
      //   import { collectSse } from "../support/sseHelper.js";
      //   const lines = await collectSse(`http://127.0.0.1:${port}/factory/jobs/${id}/events`, 3500);
      //   expect(lines.length).toBeGreaterThanOrEqual(1);
      // Ver sseHelper.ts — se usa en test manual, no en este pact spec.
    });
  });
});
