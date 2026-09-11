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
 * F06 — Logs y result.json (dedicated endpoint)
 *
 * Contrato Pact (2 interactions) — valida endpoint dedicado queF03 no cubre:
 *   - GET /factory/jobs/:id/logs  → 200 {id, logs: string[]} con logs 'opencode: streaming'
 *   - GET /factory/jobs/:id       → 200 con resultPreview (valida result.json/logs.ndjson en disco tras done)
 *
 * Por qué F06 existe separado de F03:
 *   F03 valida GET /jobs/:id (polling) + SSE handshake, pero no valida el endpoint dedicado /logs
 *   ni la relación result.json/logs.ndjson vs resultPreview detallada.
 *   F06 cubre ese hueco usando endpoint ya existente en factoryServer.ts line 485-500
 *   (GET /factory/jobs/:id/logs → {id, logs}) y valida disco via resultPreview.
 *
 * Provider state: "a job with logs exists" asegura job con logs (reuse job-abc123 de F03).
 * Windows only — worktree ejemplo C:\tmp\...
 */

const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_EXAMPLE = "job-abc123";
const WINDOWS_PATH_REGEX = "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_PATH_EXAMPLE = "C:\\tmp\\playground-F06-abc\\.agents\\factory\\job-abc123";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*";
const WINDOWS_WORKTREE_EXAMPLE = "C:\\tmp\\playground-F06-abc";
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";

describe("F06 — Logs y result.json (dedicated endpoint)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F06"), // "playground-F06"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("fetches logs via dedicated endpoint and validates resultPreview (disk)", async () => {
    // ── Interaction 1: GET /factory/jobs/:id/logs → 200 {id, logs} ──
    // Valida endpoint dedicado que F03 no cubre (F03 usa GET /jobs/:id y SSE, no /logs)
    pact
      .given("a job with logs exists", { id: JOB_ID_EXAMPLE })
      .uponReceiving("a request for job logs via dedicated endpoint")
      .withRequest({
        method: "GET",
        path: regex(
          "^\\/factory\\/jobs\\/job-[a-z0-9\\-]+\\/logs$",
          `/factory/jobs/${JOB_ID_EXAMPLE}/logs`,
        ),
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          id: regex(JOB_ID_REGEX, JOB_ID_EXAMPLE),
          logs: eachLike("opencode: streaming tokens…"),
        },
      });

    // ── Interaction 2: GET /factory/jobs/:id → 200 con resultPreview ──
    // Valida que disco result.json/logs.ndjson se reflejan en resultPreview (F03 lo hace parcial, F06 lo refuerza)
    pact
      .given("a job with logs exists", { id: JOB_ID_EXAMPLE })
      .uponReceiving("a request for job with resultPreview (disk validation)")
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
          prompt: like("playground-F06-abc123"),
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
            promptPreview: like("playground-F06-abc123"),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
            summary: like("Job completado correctamente (local)."),
          },
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: GET /logs dedicated ──
      const resLogs = await fetch(`${mockServer.url}/factory/jobs/${JOB_ID_EXAMPLE}/logs`, {
        headers: { Accept: "application/json" },
      });
      expect(resLogs.status).toBe(200);
      const ctypeLogs = resLogs.headers.get("content-type") ?? "";
      expect(ctypeLogs).toMatch(/application\/json/);
      const bodyLogs = (await resLogs.json()) as unknown as {
        id: unknown;
        logs: unknown;
      };
      expect(typeof bodyLogs.id).toBe("string");
      expect(Array.isArray(bodyLogs.logs)).toBe(true);
      expect((bodyLogs.logs as unknown[]).length).toBeGreaterThanOrEqual(1);
      for (const line of bodyLogs.logs as unknown[]) {
        expect(typeof line).toBe("string");
      }
      // Must contain opencode streaming token as per matcher
      const hasStreaming = (bodyLogs.logs as string[]).some((l) => l.includes("opencode"));
      // In mock eachLike returns single example "opencode: streaming tokens…" so this should be true
      expect(hasStreaming).toBe(true);

      // ── Validate interaction 2: GET /jobs/:id with resultPreview ──
      const resJob = await fetch(`${mockServer.url}/factory/jobs/${JOB_ID_EXAMPLE}`, {
        headers: { Accept: "application/json" },
      });
      expect(resJob.status).toBe(200);
      const bodyJob = (await resJob.json()) as unknown as {
        id: unknown;
        state: unknown;
        logs: unknown;
        dir: unknown;
        resultPreview: { state: unknown; jobId: unknown; summary: unknown };
      };
      expect(typeof bodyJob.id).toBe("string");
      expect(bodyJob.state).toBe("done");
      expect(Array.isArray(bodyJob.logs)).toBe(true);
      expect(typeof bodyJob.dir).toBe("string");
      expect(bodyJob.resultPreview.state).toBe("done");
      expect(typeof bodyJob.resultPreview.jobId).toBe("string");
      expect(typeof bodyJob.resultPreview.summary).toBe("string");
    });
  });
});
