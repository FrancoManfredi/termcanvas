import { describe, it, expect } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import {
  PACT_DIR,
  PACT_LOG_LEVEL,
  FACTORY_PROVIDER,
  consumerNameFor,
} from "../support/pactConfig.js";

const { like, regex } = MatchersV3;

/**
 * F07 — Manejo de errores 400/404 (DX)
 *
 * Contrato Pact (2 interactions) — cubre los paths de error que hoy NO tienen pact y son críticos para DX:
 *   1) POST /factory/jobs sin prompt → 400 {error: "prompt is required", hint: string, received: string}
 *      Given "factory is healthy" (reuse) — body sin prompt, solo worktree+phase (Windows path C:\tmp\...)
 *      Valida DX: en PowerShell el hint guía al usuario (Invoke-RestMethod / curl.exe)
 *   2) GET /factory/jobs/job-notexist-99 → 404 {error: "job not found"}
 *      Given "no job exists" (no-op) — asegura que job inexistente responde 404 no 500 ni 200
 *
 * Verifica que factoryServer.ts ya implementa esos 400/404:
 *   - POST valida prompt required (line ~304) y devuelve JSON con hint
 *   - GET /jobs/:id 404 con {error: `job not found: ${id}`}
 *
 * Windows only — worktree ejemplo C:\tmp\...
 */

const WINDOWS_WORKTREE_EXAMPLE = "C:\\tmp\\playground-F07-noprompt";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*";
const JOB_NOT_EXIST_ID = "job-notexist-99";
const JOB_NOT_EXIST_PATH_REGEX = "^\\/factory\\/jobs\\/job-notexist-99$";
const JOB_NOT_EXIST_PATH = `/factory/jobs/${JOB_NOT_EXIST_ID}`;

describe("F07 — Manejo de errores 400/404 (DX)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F07"), // "playground-F07"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("returns 400 hint when prompt missing and 404 for nonexistent job", async () => {
    // ── Interaction 1: POST /factory/jobs sin prompt → 400 {error, hint, received} ──
    // Given "factory is healthy" reuse — valida DX 400 útil
    // Body: {worktree, phase} sin prompt — asegurar que no se filtre via JSON stringify (sin prompt key)
    pact
      .given("factory is healthy")
      .uponReceiving("a request to create a job without prompt (DX 400)")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        headers: { "Content-Type": "application/json" },
        body: {
          worktree: like(WINDOWS_WORKTREE_EXAMPLE),
          phase: like("diagnosisLlm"),
        },
      })
      .willRespondWith({
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: {
          error: regex(".*prompt is required.*", "prompt is required"),
          hint: like("En PowerShell usa Invoke-RestMethod -UseBasicParsing -Body '{\"prompt\":\"hola\",...}'"),
          received: like(`{"worktree":"${WINDOWS_WORKTREE_EXAMPLE}","phase":"diagnosisLlm"}`),
        },
      });

    // ── Interaction 2: GET /factory/jobs/:id inexistente → 404 {error} ──
    pact
      .given("no job exists")
      .uponReceiving("a request for nonexistent job (DX 404)")
      .withRequest({
        method: "GET",
        path: regex(JOB_NOT_EXIST_PATH_REGEX, JOB_NOT_EXIST_PATH),
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: {
          error: regex(".*job not found.*", `job not found: ${JOB_NOT_EXIST_ID}`),
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: POST sin prompt → 400 ──
      // Asegurar que body sin prompt llegue como body sin prompt y no sea filtrado por JSON stringify
      const res400 = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktree: WINDOWS_WORKTREE_EXAMPLE,
          phase: "diagnosisLlm",
        }),
      });
      expect(res400.status).toBe(400);
      const ctype400 = res400.headers.get("content-type") ?? "";
      expect(ctype400).toMatch(/application\/json/);
      const body400 = (await res400.json()) as unknown as {
        error: unknown;
        hint: unknown;
        received: unknown;
      };
      expect(typeof body400.error).toBe("string");
      expect(String(body400.error)).toMatch(/prompt is required/);
      expect(typeof body400.hint).toBe("string");
      expect((body400.hint as string).length).toBeGreaterThan(0);
      expect(typeof body400.received).toBe("string");
      // received debe ser type string (no validar contenido exacto, solo que existe y es string)
      // En provider real será raw.slice(0,300) del body enviado

      // ── Validate interaction 2: GET nonexistent → 404 ──
      const res404 = await fetch(`${mockServer.url}/factory/jobs/${JOB_NOT_EXIST_ID}`, {
        headers: { Accept: "application/json" },
      });
      expect(res404.status).toBe(404);
      const ctype404 = res404.headers.get("content-type") ?? "";
      expect(ctype404).toMatch(/application\/json/);
      const body404 = (await res404.json()) as unknown as { error: unknown };
      expect(typeof body404.error).toBe("string");
      expect(String(body404.error)).toMatch(/job not found/);
    });
  });
});
