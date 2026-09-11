import { describe, it, expect } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import {
  PACT_DIR,
  PACT_LOG_LEVEL,
  FACTORY_PROVIDER,
  consumerNameFor,
} from "../support/pactConfig.js";

const { like, integer, regex, eachLike } = MatchersV3;

/**
 * F08 — Cola y concurrencia básica (múltiples jobs)
 *
 * Contrato Pact (2 interactions) — valida que múltiples POST /factory/jobs
 * incrementan la lista y que health refleja queue coherente.
 * Cierra el gap de concurrencia que F02/F04 no cubren (solo 1 job).
 *
 *   1) GET /factory/jobs → 200 {jobs: eachLike min:2 con id regex, phase type, state queued|running|done|error, dir Windows}
 *      Given "multiple jobs exist" (stateHandler crea 2 jobs distintos si no hay ≥2, via POST a Factory)
 *   2) GET /factory/health → 200 {queue:{pending:integer, running:integer}, uptime:integer, version like "local", ts regex ISO8601}
 *      Given "factory is healthy after jobs" — reuse F01 matchers pero con providerState distinto para no colisionar
 *
 * factoryServer soporta ambos (ya implementa GET /factory/jobs lista y GET /factory/health con queue).
 * Windows paths: dir regex valida C:\tmp\...\.agents\factory\job-... con posible espacio.
 * Headers plain application/json (no regex charset).
 */

const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_EXAMPLE = "job-f08-a1b2c3d4";
const WINDOWS_DIR_REGEX = "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_DIR_EXAMPLE = "C:\\tmp\\playground-F08-abc\\.agents\\factory\\job-f08-a1b2c3d4";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*";
const WINDOWS_WORKTREE_EXAMPLE = "C:\\tmp\\playground-F08-abc";
const STATE_REGEX = "^(queued|running|done|error)$";
const STATE_EXAMPLE = "queued";
// ISO8601 UTC with milliseconds (same as F01)
const ISO8601_REGEX = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
const ISO8601_EXAMPLE = "2026-05-13T14:22:10.123Z";
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";

describe("F08 — Cola y concurrencia (múltiples jobs)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F08"), // "playground-F08"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("lists multiple jobs and health remains coherent after queue", async () => {
    // ── Interaction 1: GET /factory/jobs → 200 {jobs: eachLike min:2} ──
    // Valida cola: múltiples POST incrementan lista; eachLike con min:2 asegura al menos 2 jobs
    pact
      .given("multiple jobs exist")
      .uponReceiving("a request to list multiple factory jobs (concurrency)")
      .withRequest({
        method: "GET",
        path: "/factory/jobs",
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          jobs: eachLike(
            {
              id: regex(JOB_ID_REGEX, JOB_ID_EXAMPLE),
              prompt: like("playground-F08-prompt"),
              worktree: regex(WINDOWS_WORKTREE_REGEX, WINDOWS_WORKTREE_EXAMPLE),
              phase: like("diagnosisLlm"),
              state: regex(STATE_REGEX, STATE_EXAMPLE),
              createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
              updatedAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
              logsCount: like(1),
              dir: regex(WINDOWS_DIR_REGEX, WINDOWS_DIR_EXAMPLE),
            },
            2,
          ),
        },
      });

    // ── Interaction 2: GET /factory/health → 200 {queue, uptime, version, ts} ──
    // Reusa matchers F01 pero con providerState distinto "factory is healthy after jobs" para asegurar health sigue OK tras tener jobs en cola
    pact
      .given("factory is healthy after jobs")
      .uponReceiving("a request for health after jobs exist")
      .withRequest({
        method: "GET",
        path: "/factory/health",
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          queue: {
            pending: integer(1),
            running: integer(0),
          },
          uptime: integer(12345),
          version: like("local"),
          ts: regex(ISO8601_REGEX, ISO8601_EXAMPLE),
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: GET /factory/jobs → min 2 jobs ──
      const resJobs = await fetch(`${mockServer.url}/factory/jobs`, {
        headers: { Accept: "application/json" },
      });
      expect(resJobs.status).toBe(200);
      const ctypeJobs = resJobs.headers.get("content-type") ?? "";
      expect(ctypeJobs).toMatch(/application\/json/);
      const bodyJobs = (await resJobs.json()) as unknown as {
        jobs: Array<{
          id: unknown;
          phase: unknown;
          state: unknown;
          dir: unknown;
          worktree?: unknown;
          prompt?: unknown;
        }>;
      };
      expect(Array.isArray(bodyJobs.jobs)).toBe(true);
      // eachLike min:2 → al menos 2 elementos
      expect(bodyJobs.jobs.length).toBeGreaterThanOrEqual(2);
      for (const job of bodyJobs.jobs) {
        expect(typeof job.id).toBe("string");
        expect(String(job.id)).toMatch(/^job-[a-z0-9\-]+$/);
        expect(typeof job.phase).toBe("string");
        expect(["queued", "running", "done", "error"]).toContain(job.state as string);
        expect(typeof job.dir).toBe("string");
        // Windows path check: debe contener .agents\factory\job- y letra de unidad
        expect(String(job.dir)).toMatch(/^[A-Z]:\\.*\.agents\\factory\\job-.*/);
      }

      // ── Validate interaction 2: GET /factory/health → queue coherente ──
      const resHealth = await fetch(`${mockServer.url}/factory/health`, {
        headers: { Accept: "application/json" },
      });
      expect(resHealth.status).toBe(200);
      const ctypeHealth = resHealth.headers.get("content-type") ?? "";
      expect(ctypeHealth).toMatch(/application\/json/);
      const bodyHealth = (await resHealth.json()) as unknown as {
        queue: { pending: unknown; running: unknown };
        uptime: unknown;
        version: unknown;
        ts: unknown;
      };
      expect(typeof bodyHealth.queue.pending).toBe("number");
      expect(Number.isInteger(bodyHealth.queue.pending as number)).toBe(true);
      expect(typeof bodyHealth.queue.running).toBe("number");
      expect(Number.isInteger(bodyHealth.queue.running as number)).toBe(true);
      expect(typeof bodyHealth.uptime).toBe("number");
      expect(typeof bodyHealth.version).toBe("string");
      expect(typeof bodyHealth.ts).toBe("string");
      expect(String(bodyHealth.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
