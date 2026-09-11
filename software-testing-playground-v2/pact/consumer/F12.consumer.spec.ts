import { describe, it, expect } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import {
  PACT_DIR,
  PACT_LOG_LEVEL,
  FACTORY_PROVIDER,
  consumerNameFor,
} from "../support/pactConfig.js";

const { regex } = MatchersV3;

/**
 * F12 — Cancel errores 409 ya done y 404 no existe
 *
 * Complementa F04 (que pacta cancel success 200) validando los paths de error
 * que hoy no tienen contrato y son gap: nunca probamos POST /cancel sobre job
 * ya done (409) ni sobre job inexistente (404).
 *
 * Contrato Pact (2 interactions) — Windows only, headers plain, body {}:
 *  1) POST /factory/jobs/job-f12-done01/cancel sobre job ya done/error
 *     Given "a job that is done" with {id:"job-f12-done01"}
 *     → 409 {error: regex "already (done|error)"} Headers plain application/json body {}
 *     Valida que factoryServer devuelve 409 si state done/error (factoryServer.ts ~596)
 *     ProviderState handler asegura job en done antes de verificar para no flaky.
 *  2) POST /factory/jobs/job-notexist-99/cancel sobre job inexistente
 *     Given "no job exists" (reuse, id job-notexist-99 por defecto)
 *     → 404 {error: regex "job not found"} Similar a GET 404 pero via POST cancel
 *     Verifica 404 si !job (factoryServer ~592)
 *
 * Windows only — factoryServer real, sin PTY. No menciona health ni events.
 */

const JOB_DONE_ID = "job-f12-done01";
const JOB_DONE_CANCEL_REGEX = "^\\/factory\\/jobs\\/job-f12-done01\\/cancel$";
const JOB_DONE_CANCEL_PATH = `/factory/jobs/${JOB_DONE_ID}/cancel`;
const JOB_NOT_EXIST_ID = "job-notexist-99";
const JOB_NOT_EXIST_CANCEL_REGEX = "^\\/factory\\/jobs\\/job-notexist-99\\/cancel$";
const JOB_NOT_EXIST_CANCEL_PATH = `/factory/jobs/${JOB_NOT_EXIST_ID}/cancel`;

describe("F12 — Cancel errores 409 ya done y 404 no existe", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F12"), // "playground-F12"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("returns 409 when cancelling already done job and 404 for nonexistent job", async () => {
    // ── Interaction 1: POST /factory/jobs/job-f12-done01/cancel → 409 already done/error ──
    // Given "a job that is done" — handler asegura job en done (reuse job-abc123 done o crea job-f12-done01 y espera poll until done)
    pact
      .given("a job that is done", { id: JOB_DONE_ID })
      .uponReceiving("a request to cancel an already done job (409)")
      .withRequest({
        method: "POST",
        path: regex(JOB_DONE_CANCEL_REGEX, JOB_DONE_CANCEL_PATH),
        headers: { "Content-Type": "application/json" },
        body: {},
      })
      .willRespondWith({
        status: 409,
        headers: { "Content-Type": "application/json" },
        body: {
          error: regex(".*already (done|error).*", "job already done"),
        },
      });

    // ── Interaction 2: POST /factory/jobs/job-notexist-99/cancel → 404 job not found ──
    // Given "no job exists" reuse — asegura que job inexistente responde 404 no 500
    pact
      .given("no job exists")
      .uponReceiving("a request to cancel nonexistent job (404)")
      .withRequest({
        method: "POST",
        path: regex(JOB_NOT_EXIST_CANCEL_REGEX, JOB_NOT_EXIST_CANCEL_PATH),
        headers: { "Content-Type": "application/json" },
        body: {},
      })
      .willRespondWith({
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: {
          error: regex(".*job not found.*", `job not found: ${JOB_NOT_EXIST_ID}`),
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: POST cancel done → 409 ──
      const res409 = await fetch(`${mockServer.url}/factory/jobs/${JOB_DONE_ID}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res409.status).toBe(409);
      const ctype409 = res409.headers.get("content-type") ?? "";
      expect(ctype409).toMatch(/application\/json/);
      const body409 = (await res409.json()) as unknown as { error: unknown };
      expect(typeof body409.error).toBe("string");
      expect(String(body409.error)).toMatch(/already (done|error)/);

      // ── Validate interaction 2: POST cancel notexist → 404 ──
      const res404 = await fetch(`${mockServer.url}/factory/jobs/${JOB_NOT_EXIST_ID}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
