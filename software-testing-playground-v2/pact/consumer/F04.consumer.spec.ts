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
 * F04 — Panel Factory — lista Queued/Running/Done + Cancel (hybrid Pact)
 *
 * Contrato Pact (HTTP) — Ola Cancel (2 interactions):
 *   - GET  /factory/jobs                     → 200 { jobs: Array<job> } (panel lista)
 *   - POST /factory/jobs/:id/cancel          → 200 { ok: true, state: "error" } (cancelar)
 *
 * Parte hybrid/human (NO pacteable, requiere ojo):
 *   - Filtros UI Queued/Running/Done (estado derivado en React, no HTTP contrato)
 *   - Botón "Ver logs" que hace GET /factory/jobs/:id/logs + SSE en vivo (ver F03 sseHelper)
 *   - El Panel lista y el Cancel ya están pacteados; human valida solo filtros y tail vivo
 *   - Encolar desde FactoryPlayground → F04TestZone sin PTY (ver verifiers/verify-F04.human.md)
 *
 * Este spec es híbrido ampliado (Ola Cancel): Pact valida lista HTTP + cancel POST,
 * human valida filtros UI y tail vivo. Arquitectura: architecture-pact-v2.md §3.3 aplica igual a F04.
 *
 * Nota Windows: worktree ejemplo C:\tmp\...
 * Nota providerState: "factory has jobs" crea un job vía POST antes de verificar lista,
 *   "a cancellable job exists" crea un job queued vía POST con id determinístico antes de verificar cancel,
 *   asegurando state queued (no esperar a done, para que cancel no dé 409 flaky).
 */

const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_EXAMPLE = "job-f04-panel01";
const JOB_ID_CANCEL_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_CANCEL_EXAMPLE = "job-f04-cancel01";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*";
const WINDOWS_WORKTREE_EXAMPLE = "C:\\tmp\\playground-F04-abc";
const WINDOWS_PATH_REGEX = "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_PATH_EXAMPLE =
  "C:\\tmp\\playground-F04-abc\\.agents\\factory\\job-f04-panel01";
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";

describe("F04 — Panel Factory — lista Queued/Running/Done + Cancel (hybrid)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F04"),
    provider: FACTORY_PROVIDER,
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("lists factory jobs for panel and cancels a cancellable job", async () => {
    // ── Interaction 1: GET /factory/jobs → 200 list (panel) ──
    pact
      .given("factory has jobs")
      .uponReceiving("a request to list factory jobs for panel")
      .withRequest({
        method: "GET",
        path: "/factory/jobs",
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          jobs: eachLike({
            id: regex(JOB_ID_REGEX, JOB_ID_EXAMPLE),
            prompt: like("playground-F04-panel-test"),
            worktree: regex(WINDOWS_WORKTREE_REGEX, WINDOWS_WORKTREE_EXAMPLE),
            phase: like("diagnosisLlm"),
            state: regex("^(queued|running|done|error)$", "queued"),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
            updatedAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
            logsCount: like(1),
            dir: regex(WINDOWS_PATH_REGEX, WINDOWS_PATH_EXAMPLE),
          }),
        },
      });

    // ── Interaction 2: POST /factory/jobs/:id/cancel → 200 {ok:true, state:"error"} ──
    // Pact valida que cancel existe y responde 200 sin flaky 409.
    // El providerState handler asegura job en queued (no done) antes de verificar.
    // Request: POST con regex path, headers Content-Type, body vacío/{}.
    // Response: 200 con ok:boolean y state:"error".
    pact
      .given("a cancellable job exists", { id: JOB_ID_CANCEL_EXAMPLE })
      .uponReceiving("a request to cancel a job")
      .withRequest({
        method: "POST",
        path: regex(
          "^\\/factory\\/jobs\\/job-[a-z0-9\\-]+\\/cancel$",
          `/factory/jobs/${JOB_ID_CANCEL_EXAMPLE}/cancel`
        ),
        headers: { "Content-Type": "application/json" },
        body: {},
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          ok: like(true),
          state: regex("^error$", "error"),
          id: regex(JOB_ID_CANCEL_REGEX, JOB_ID_CANCEL_EXAMPLE),
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: list jobs ──
      const resList = await fetch(`${mockServer.url}/factory/jobs`, {
        headers: { Accept: "application/json" },
      });
      expect(resList.status).toBe(200);
      const bodyList = (await resList.json()) as unknown as {
        jobs: Array<{
          id: unknown;
          state: unknown;
          worktree: unknown;
          dir: unknown;
        }>;
      };
      expect(Array.isArray(bodyList.jobs)).toBe(true);
      // Pact eachLike garantiza al menos un job; validamos shape mínimo
      expect(bodyList.jobs.length).toBeGreaterThanOrEqual(1);
      const first = bodyList.jobs[0] as {
        id: unknown;
        state: unknown;
      };
      expect(typeof first.id).toBe("string");
      expect(["queued", "running", "done", "error"]).toContain(first.state as string);

      // Nota hybrid: filtros UI Queued/Running/Done son React derived — human checklist.
      // Se validan con verifiers/verify-F04.human.md (filtros + tail vivo, Cancel ya pacteado).

      // ── Validate interaction 2: cancel job ──
      const resCancel = await fetch(
        `${mockServer.url}/factory/jobs/${JOB_ID_CANCEL_EXAMPLE}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      expect(resCancel.status).toBe(200);
      const bodyCancel = (await resCancel.json()) as unknown as {
        ok: unknown;
        state: unknown;
        id: unknown;
      };
      expect(typeof bodyCancel.ok).toBe("boolean");
      expect(bodyCancel.ok).toBe(true);
      expect(bodyCancel.state).toBe("error");
      expect(typeof bodyCancel.id).toBe("string");
    });
  });
});
